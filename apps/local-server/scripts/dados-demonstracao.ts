/**
 * Cria (ou RECRIA) um banco SEPARADO de demonstração com 7 dias de movimento
 * realista, para ver o painel funcionando. O banco real nunca é tocado.
 *
 *   npm run demo:criar                         # banco "estacionamento_demo"
 *   npm run demo:criar -- --banco=outro_demo   # o nome precisa conter "demo"
 *
 * Login: demo / Painel2026
 */
import type { RowDataPacket } from 'mysql2/promise';

const args = process.argv.slice(2);
const banco = args.find((a) => a.startsWith('--banco='))?.split('=')[1] ?? 'estacionamento_demo';
if (!banco.includes('demo')) {
  console.error('Por segurança, o nome do banco de demonstração precisa conter "demo".');
  process.exit(1);
}
// Precisa vir ANTES de carregar os módulos: o pool lê DB_NAME ao ser criado.
process.env.DB_NAME = banco;

const { env } = await import('../src/config/env.js');
const { migrarBancoLocal } = await import('../src/db/scripts-sql.js');
const { pool, fecharPool } = await import('../src/db/pool.js');
const { comTransacao } = await import('../src/db/transacao.js');
const { criarAdministrador } = await import('../src/modules/instalacao/instalacao.service.js');
const c = await import('../src/modules/demonstracao/cenario.js');

if (env.NODE_ENV === 'production') {
  console.error('Não gere dados de demonstração com NODE_ENV=production.');
  process.exit(1);
}

/** Gerador pseudoaleatório com semente (o mesmo padrão a cada execução). */
function mulberry32(semente: number) {
  return () => {
    semente |= 0;
    semente = (semente + 0x6d2b79f5) | 0;
    let t = Math.imul(semente ^ (semente >>> 15), 1 | semente);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const aleatorio = mulberry32(2026);
const entre = (a: number, b: number) => a + Math.floor(aleatorio() * (b - a + 1));
const escolher = <T>(pesos: [T, number][]): T => {
  const total = pesos.reduce((s, [, p]) => s + p, 0);
  let r = aleatorio() * total;
  for (const [v, p] of pesos) if ((r -= p) <= 0) return v;
  return pesos[0]![0];
};
const LETRAS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
const placa = () =>
  `${LETRAS[entre(0, 22)]}${LETRAS[entre(0, 22)]}${LETRAS[entre(0, 22)]}${entre(0, 9)}${LETRAS[entre(0, 22)]}${entre(10, 99)}`;

const MIN = 60_000;
const HORA = 60 * MIN;

console.log(`Criando banco de demonstração "${banco}"...`);
await migrarBancoLocal({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  banco,
  recriar: true,
});

const { siteId, usuarioId } = await criarAdministrador({
  nomeEstacionamento: 'Estacionamento Demonstração',
  nome: 'Administrador Demo',
  login: 'demo',
  senha: 'Painel2026',
});

const [[t]] = await pool.query<RowDataPacket[]>(
  `SELECT NOW(3) AS agora, CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', ?)), ?, '+00:00') AS inicio`,
  [env.FUSO_OFFSET, env.FUSO_OFFSET],
);
const agora = t?.agora as Date;
const inicioHoje = t?.inicio as Date;

const base = await comTransacao({ usuarioId, motivo: 'dados de demonstração' }, (con) =>
  c.criarCadastrosBase(con, {
    siteId,
    usuarioId,
    vagasCarro: 30,
    vagasMoto: 10,
    manutencao: 2,
    vigenteDesde: new Date(inicioHoje.getTime() - 8 * 24 * HORA),
  }),
);

/** Agenda de cada vaga: só entra carro em vaga livre naquele horário. */
const vagas = {
  carro: base.vagas.carro.slice(0, 28).map((id) => ({ id, livreEm: 0 })),
  moto: base.vagas.moto.map((id) => ({ id, livreEm: 0 })),
};
function reservarVaga(cat: 'carro' | 'moto', entrada: Date, saida: Date | null): string | null {
  const livres = vagas[cat].filter((v) => v.livreEm <= entrada.getTime());
  if (!livres.length) return null; // lotado: o carro não entra
  const v = livres[entre(0, livres.length - 1)]!;
  v.livreEm = saida ? saida.getTime() : Number.POSITIVE_INFINITY;
  return v.id;
}

interface Planejada {
  cat: 'carro' | 'moto';
  entrada: Date;
  saida: Date | null;
  modalidade: 'AVULSO' | 'DIARIA';
  forma: string;
  cancelar: boolean;
  adiantado: boolean;
}

const abertasHoje: (Planejada & { vagaId: string })[] = [];
const comum = { siteId, operadorId: usuarioId, postoId: base.postoId };
let totalSessoes = 0;

// Um veículo "esquecido": entrou ontem cedo na diária e ainda está lá (gera alerta).
const esquecido = new Date(agora.getTime() - 26 * HORA);
const vagaEsquecido = reservarVaga('carro', esquecido, null);
if (vagaEsquecido) {
  abertasHoje.push({
    cat: 'carro',
    entrada: esquecido,
    saida: null,
    modalidade: 'DIARIA',
    forma: 'PIX',
    cancelar: false,
    adiantado: false,
    vagaId: vagaEsquecido,
  });
}

for (let d = 6; d >= 0; d--) {
  const inicioDia = new Date(inicioHoje.getTime() - d * 24 * HORA);
  const fimDia = new Date(inicioDia.getTime() + 22 * HORA);
  const diaSemana = new Date(inicioDia.getTime() + 12 * HORA).getUTCDay();
  const quantidade = diaSemana === 0 ? entre(30, 40) : diaSemana === 6 ? entre(45, 60) : entre(70, 95);

  const planejadas: Planejada[] = Array.from({ length: quantidade }, () => {
    const horaEntrada = escolher<number>([
      [7, 6],
      [8, 12],
      [9, 9],
      [10, 6],
      [11, 6],
      [12, 9],
      [13, 8],
      [14, 6],
      [15, 5],
      [16, 5],
      [17, 6],
      [18, 7],
      [19, 4],
      [20, 2],
    ]);
    const entrada = new Date(inicioDia.getTime() + horaEntrada * HORA + entre(0, 59) * MIN);
    const tipo = escolher<'curta' | 'media' | 'diaria'>([
      ['curta', 70],
      ['media', 20],
      ['diaria', 10],
    ]);
    const minutos = tipo === 'curta' ? entre(15, 180) : tipo === 'media' ? entre(180, 480) : entre(240, 600);
    const saida = new Date(Math.min(entrada.getTime() + minutos * MIN, fimDia.getTime()));
    return {
      cat: aleatorio() < 0.8 ? 'carro' : 'moto',
      entrada,
      saida,
      modalidade: tipo === 'diaria' ? 'DIARIA' : 'AVULSO',
      forma: escolher<string>([
        ['PIX', 45],
        ['DEBITO', 20],
        ['CREDITO', 20],
        ['DINHEIRO', 15],
      ]),
      cancelar: aleatorio() < 0.02,
      adiantado: aleatorio() < 0.1,
    };
  });
  // Hoje: só o que já aconteceu. Quem ainda não saiu fica estacionado.
  const doDia = planejadas
    .filter((p) => p.entrada.getTime() < agora.getTime() - 5 * MIN)
    .map((p) => (d === 0 && p.saida && p.saida.getTime() > agora.getTime() - MIN ? { ...p, saida: null } : p))
    .sort((a, b) => a.entrada.getTime() - b.entrada.getTime());

  await comTransacao({ usuarioId, motivo: 'dados de demonstração' }, async (con) => {
    const abertura = new Date(
      Math.min(
        inicioDia.getTime() + 6.5 * HORA,
        Math.max(inicioDia.getTime() + MIN, agora.getTime() - 2 * MIN),
      ),
    );
    const caixa = await c.abrirCaixa(con, { ...comum, em: abertura, saldoInicial: 10_000 });
    let estornou = false;

    for (const p of doDia) {
      const saidaReal = p.cancelar ? new Date(p.entrada.getTime() + 3 * MIN) : p.saida;
      const vagaId = reservarVaga(p.cat, p.entrada, saidaReal);
      if (!vagaId) continue;
      if (saidaReal === null) {
        abertasHoje.push({ ...p, vagaId });
        continue;
      }
      const regraId = p.cat === 'carro' ? base.regras.carro : base.regras.moto;
      const regra = p.cat === 'carro' ? c.REGRA_CARRO : c.REGRA_MOTO;
      const sessaoId = await c.registrarEntrada(con, {
        ...comum,
        categoriaId: base.categorias[p.cat],
        regraId,
        vagaId,
        placa: placa(),
        em: p.entrada,
        modalidade: p.modalidade,
      });
      totalSessoes++;
      if (p.cancelar) {
        await c.cancelarSessao(con, {
          sessaoId,
          em: saidaReal,
          operadorId: usuarioId,
          motivo: 'Entrada registrada em duplicidade',
        });
        continue;
      }
      const em = saidaReal.getTime() >= agora.getTime() ? new Date(agora.getTime() - MIN) : saidaReal;
      await c.registrarSaida(con, {
        ...comum,
        sessaoId,
        regra,
        entradaEm: p.entrada,
        em,
        caixaId: caixa,
        forma: p.forma,
        modalidade: p.modalidade,
      });

      // Um estorno a cada dois ou três dias (cliente cobrado em duplicidade)
      if (!estornou && d % 3 === 1) {
        const [[pg]] = await con.query<RowDataPacket[]>(
          "SELECT id FROM pagamentos WHERE sessao_id = ? AND status = 'CONFIRMADO' LIMIT 1",
          [sessaoId],
        );
        if (pg) {
          await c.estornarPagamento(con, {
            siteId,
            pagamentoId: String(pg.id),
            caixaId: caixa,
            operadorId: usuarioId,
            em: new Date(em.getTime() + MIN),
            motivo: 'Cobrado em duplicidade',
          });
          estornou = true;
        }
      }
    }

    if (d > 0) await c.fecharCaixa(con, { caixaId: caixa, em: fimDia, operadorId: usuarioId });
    else {
      // Veículos estacionados agora (inclui o "esquecido" de ontem)
      for (const p of abertasHoje) {
        const regraId = p.cat === 'carro' ? base.regras.carro : base.regras.moto;
        const sessaoId = await c.registrarEntrada(con, {
          ...comum,
          categoriaId: base.categorias[p.cat],
          regraId,
          vagaId: p.vagaId,
          placa: placa(),
          em: p.entrada,
          modalidade: p.modalidade,
        });
        totalSessoes++;
        if (p.adiantado) {
          await c.registrarPagamento(con, {
            siteId,
            sessaoId,
            caixaId: caixa,
            forma: 'PIX',
            valor: 500,
            operadorId: usuarioId,
            em: new Date(Math.max(p.entrada.getTime() + MIN, inicioDia.getTime() + MIN)),
          });
        }
      }
    }
  });
}

const [[r]] = await pool.query<RowDataPacket[]>(
  "SELECT (SELECT COUNT(*) FROM sessoes_estacionamento WHERE status='ABERTA') AS abertas, (SELECT COALESCE(SUM(valor_centavos),0) FROM pagamentos WHERE status='CONFIRMADO') AS total",
);
console.log(
  `✔ ${totalSessoes} tickets em 7 dias, ${r?.abertas} veículos estacionados agora, R$ ${(Number(r?.total) / 100).toFixed(2)} recebidos.`,
);
console.log('  Login: demo   Senha: Painel2026');
await fecharPool();
