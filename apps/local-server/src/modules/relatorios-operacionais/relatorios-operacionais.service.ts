import type { RowDataPacket } from 'mysql2/promise';
import { calcularEstadia } from '@estacionamento/calculo';
import {
  normalizarPlaca,
  type FiltroOperacional,
  type HistoricoPlaca,
  type IndicadoresOperacionais,
  type LinhaMovimento,
  type Modalidade,
  type MovimentoFuncionario,
  type OpcaoFuncionario,
  type RelatorioBloqueios,
  type RelatorioMovimento,
  type RelatorioOcupacao,
  type VeiculoEstacionado,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { erros } from '../../http/erros.js';
import { COLUNAS_REGRA, regraDoTicket } from '../tarifas/regra.js';

/**
 * Relatórios administrativos (operação). Tudo calculado com os dados reais do
 * banco local; datas no fuso do estacionamento (FUSO_OFFSET).
 */
const HORA = 3_600_000;
const DIA = 24 * HORA;
const LIMITE_LINHAS = 2000;
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const n = (v: unknown) => Number(v ?? 0);

/** Início do dia local "AAAA-MM-DD" em UTC. */
const inicioDoDia = (d: string) => new Date(`${d}T00:00:00${env.FUSO_OFFSET}`);
const desvioMs = () => {
  const [, s, h, m] = /^([+-])(\d{2}):(\d{2})$/.exec(env.FUSO_OFFSET)!;
  return (s === '-' ? -1 : 1) * (Number(h) * 60 + Number(m)) * 60_000;
};
const diaLocal = (d: Date) => new Date(d.getTime() + desvioMs()).toISOString().slice(0, 10);
const horaLocal = (d: Date) => new Date(d.getTime() + desvioMs()).getUTCHours();

function intervalo(f: { de: string; ate: string }, maxDias = 366) {
  const inicio = inicioDoDia(f.de);
  const fim = new Date(inicioDoDia(f.ate).getTime() + DIA);
  const dias = Math.round((fim.getTime() - inicio.getTime()) / DIA);
  if (dias < 1) throw erros.requisicaoInvalida('A data inicial precisa ser anterior à final.');
  if (dias > maxDias) throw erros.requisicaoInvalida(`Escolha um período de até ${maxDias} dias.`);
  return { inicio, fim, dias };
}

const SELECT_MOVIMENTO = `
  SELECT s.id, s.numero, s.placa, c.nome AS categoria, v.codigo AS vaga, s.status, s.entrada_em, s.saida_em,
         s.cancelado_em, s.valor_final_centavos,
         TIMESTAMPDIFF(MINUTE, s.entrada_em, COALESCE(s.saida_em, s.cancelado_em, NOW(3))) AS permanencia,
         COALESCE(fe.nome, ue.login) AS operador_entrada, COALESCE(fs.nome, us.login) AS operador_saida
    FROM sessoes_estacionamento s
    JOIN categorias_veiculo c ON c.id = s.categoria_id
    LEFT JOIN vagas v ON v.id = s.vaga_id
    JOIN usuarios ue ON ue.id = s.operador_entrada_id
    LEFT JOIN funcionarios fe ON fe.usuario_id = ue.id
    LEFT JOIN usuarios us ON us.id = COALESCE(s.operador_saida_id, s.cancelado_por)
    LEFT JOIN funcionarios fs ON fs.usuario_id = us.id`;

function linhaMovimento(l: RowDataPacket): LinhaMovimento {
  return {
    id: String(l.id),
    numero: String(l.numero),
    placa: String(l.placa),
    categoria: String(l.categoria),
    vaga: (l.vaga as string | null) ?? null,
    situacao: l.status,
    entradaEm: iso(l.entrada_em)!,
    saidaEm: iso(l.saida_em),
    canceladoEm: iso(l.cancelado_em),
    permanenciaMin: n(l.permanencia),
    valorFinalCentavos: l.valor_final_centavos === null ? null : n(l.valor_final_centavos),
    operadorEntrada: String(l.operador_entrada),
    operadorSaida: (l.operador_saida as string | null) ?? null,
  };
}

/** Sessões (não canceladas) que ocuparam vaga em algum momento do intervalo. */
async function sessoesNoIntervalo(siteId: string, inicio: Date, fim: Date) {
  const [l] = await pool.query<RowDataPacket[]>(
    `SELECT s.entrada_em, COALESCE(s.saida_em, NOW(3)) AS fim, c.nome AS categoria
       FROM sessoes_estacionamento s JOIN categorias_veiculo c ON c.id = s.categoria_id
      WHERE s.site_id = ? AND s.status <> 'CANCELADA' AND s.entrada_em < ? AND COALESCE(s.saida_em, NOW(3)) > ?`,
    [siteId, fim, inicio],
  );
  return l.map((x) => ({
    entrada: x.entrada_em as Date,
    fim: x.fim as Date,
    categoria: String(x.categoria),
  }));
}

async function capacidade(siteId: string) {
  const [l] = await pool.query<RowDataPacket[]>(
    `SELECT c.nome AS categoria, SUM(v.situacao = 'ATIVA') AS ativas
       FROM vagas v JOIN categorias_veiculo c ON c.id = v.categoria_id
      WHERE v.site_id = ? AND v.situacao IN ('ATIVA', 'MANUTENCAO') GROUP BY c.nome`,
    [siteId],
  );
  return new Map(l.map((x) => [String(x.categoria), n(x.ativas)]));
}

/** Ocupação hora a hora (média) e pico por dia, varrendo entradas e saídas. */
function calcularOcupacao(sessoes: { entrada: Date; fim: Date }[], inicio: Date, fim: Date, agora: Date) {
  const limite = Math.min(fim.getTime(), agora.getTime());
  const horas = Math.max(0, Math.ceil((limite - inicio.getTime()) / HORA));
  const somaHora = new Array<number>(horas).fill(0); // horas-veículo em cada hora
  const eventos: [number, number][] = [];
  let inicial = 0;
  for (const s of sessoes) {
    const a = Math.max(s.entrada.getTime(), inicio.getTime());
    const b = Math.min(s.fim.getTime(), limite);
    if (b <= a) continue;
    for (let h = Math.floor((a - inicio.getTime()) / HORA); h < horas; h++) {
      const ini = inicio.getTime() + h * HORA;
      const sobreposicao = Math.min(b, ini + HORA) - Math.max(a, ini);
      if (sobreposicao <= 0) break;
      somaHora[h]! += sobreposicao / HORA;
    }
    if (s.entrada.getTime() <= inicio.getTime()) inicial++;
    else eventos.push([s.entrada.getTime(), 1]);
    if (s.fim.getTime() < limite) eventos.push([s.fim.getTime(), -1]);
  }
  // Pico por dia: varredura em ordem (saída antes de entrada no mesmo instante)
  eventos.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const pico = new Map<string, { valor: number; em: number }>();
  let atual = inicial;
  const marcar = (t: number) => {
    const d = diaLocal(new Date(t));
    const p = pico.get(d);
    if (!p || atual > p.valor) pico.set(d, { valor: atual, em: t });
  };
  marcar(inicio.getTime());
  for (const [t, delta] of eventos) {
    atual += delta;
    marcar(t);
  }
  return { somaHora, pico, horas };
}

export const relatoriosOperacionaisService = {
  async funcionarios(): Promise<OpcaoFuncionario[]> {
    const site = await obterSiteAtual();
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT DISTINCT u.id, COALESCE(f.nome, u.login) AS nome FROM usuarios u
         LEFT JOIN funcionarios f ON f.usuario_id = u.id
        WHERE u.id IN (SELECT operador_entrada_id FROM sessoes_estacionamento WHERE site_id = ?)
           OR u.id IN (SELECT operador_saida_id FROM sessoes_estacionamento WHERE site_id = ?)
           OR u.id IN (SELECT registrado_por FROM pagamentos WHERE site_id = ?)
        ORDER BY nome`,
      [site.id, site.id, site.id],
    );
    return l.map((x) => ({ id: String(x.id), nome: String(x.nome) }));
  },

  /** Entradas e saídas: tickets com entrada OU saída no período. */
  async movimento(f: FiltroOperacional): Promise<RelatorioMovimento> {
    const site = await obterSiteAtual();
    const { inicio, fim } = intervalo(f);
    const where = [
      's.site_id = ?',
      '((s.entrada_em >= ? AND s.entrada_em < ?) OR (COALESCE(s.saida_em, s.cancelado_em) >= ? AND COALESCE(s.saida_em, s.cancelado_em) < ?))',
    ];
    const p: unknown[] = [site.id, inicio, fim, inicio, fim];
    if (f.placa) {
      where.push('s.placa LIKE ?');
      p.push(`${normalizarPlaca(f.placa)}%`);
    }
    if (f.situacao) {
      where.push('s.status = ?');
      p.push(f.situacao);
    }
    if (f.operadorId) {
      where.push('(s.operador_entrada_id = ? OR s.operador_saida_id = ? OR s.cancelado_por = ?)');
      p.push(f.operadorId, f.operadorId, f.operadorId);
    }
    const [linhas] = await pool.query<RowDataPacket[]>(
      `${SELECT_MOVIMENTO} WHERE ${where.join(' AND ')} ORDER BY s.entrada_em DESC LIMIT ?`,
      [...p, LIMITE_LINHAS + 1],
    );
    const itens = linhas.slice(0, LIMITE_LINHAS).map(linhaMovimento);
    // Totais e série diária (com os mesmos filtros, sem o limite de linhas)
    const [[t]] = await pool.query<RowDataPacket[]>(
      `SELECT SUM(s.entrada_em >= ? AND s.entrada_em < ?) AS entradas,
              SUM(s.status = 'ENCERRADA' AND s.saida_em >= ? AND s.saida_em < ?) AS saidas,
              SUM(s.status = 'CANCELADA' AND s.cancelado_em >= ? AND s.cancelado_em < ?) AS cancelados,
              SUM(s.status = 'ABERTA') AS abertos
         FROM sessoes_estacionamento s WHERE ${where.join(' AND ')}`,
      [inicio, fim, inicio, fim, inicio, fim, ...p],
    );
    const [serie] = await pool.query<RowDataPacket[]>(
      `SELECT s.entrada_em, s.saida_em FROM sessoes_estacionamento s WHERE ${where.join(' AND ')}`,
      p,
    );
    const dias = new Map<string, { entradas: number; saidas: number }>();
    for (let d = inicio.getTime(); d < fim.getTime(); d += DIA)
      dias.set(diaLocal(new Date(d)), { entradas: 0, saidas: 0 });
    for (const s of serie) {
      const e = dias.get(diaLocal(s.entrada_em as Date));
      if (e && (s.entrada_em as Date) >= inicio) e.entradas++;
      if (s.saida_em) {
        const x = dias.get(diaLocal(s.saida_em as Date));
        if (x) x.saidas++;
      }
    }
    return {
      totais: {
        entradas: n(t?.entradas),
        saidas: n(t?.saidas),
        cancelados: n(t?.cancelados),
        abertos: n(t?.abertos),
      },
      porDia: [...dias].map(([dia, v]) => ({ dia, ...v })),
      itens,
      truncado: linhas.length > LIMITE_LINHAS,
    };
  },

  /** Veículos no pátio agora, com o valor acumulado (mesmo cálculo do caixa). */
  async estacionados(f: { placa?: string; operadorId?: string }): Promise<VeiculoEstacionado[]> {
    const site = await obterSiteAtual();
    const where = ['s.site_id = ?', "s.status = 'ABERTA'"];
    const p: unknown[] = [site.id];
    if (f.placa) {
      where.push('s.placa LIKE ?');
      p.push(`${normalizarPlaca(f.placa)}%`);
    }
    if (f.operadorId) {
      where.push('s.operador_entrada_id = ?');
      p.push(f.operadorId);
    }
    const [l] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.numero, s.placa, c.nome AS categoria, v.codigo AS vaga, s.entrada_em, s.modalidade, s.tarifa_aplicada,
              ${COLUNAS_REGRA}, COALESCE(fe.nome, ue.login) AS operador, NOW(3) AS agora,
              COALESCE((SELECT SUM(pg.valor_centavos) FROM pagamentos pg WHERE pg.sessao_id = s.id AND pg.status = 'CONFIRMADO'), 0) AS pago
         FROM sessoes_estacionamento s
         JOIN categorias_veiculo c ON c.id = s.categoria_id
         JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
         LEFT JOIN vagas v ON v.id = s.vaga_id
         JOIN usuarios ue ON ue.id = s.operador_entrada_id
         LEFT JOIN funcionarios fe ON fe.usuario_id = ue.id
        WHERE ${where.join(' AND ')} ORDER BY s.entrada_em`,
      p,
    );
    return l.map((x) => {
      const e = calcularEstadia({
        entradaEm: x.entrada_em as Date,
        fim: x.agora as Date,
        regra: regraDoTicket(x),
        modalidade: x.modalidade as Modalidade,
        pagoCentavos: n(x.pago),
        emAndamento: true,
      });
      return {
        id: String(x.id),
        numero: String(x.numero),
        placa: String(x.placa),
        categoria: String(x.categoria),
        vaga: (x.vaga as string | null) ?? null,
        entradaEm: iso(x.entrada_em)!,
        permanenciaMin: e.permanenciaMin,
        valorAcumuladoCentavos: e.valorFinalCentavos,
        pagoCentavos: n(x.pago),
        operadorEntrada: String(x.operador),
      };
    });
  },

  async historicoPlaca(placaInformada: string): Promise<HistoricoPlaca> {
    const site = await obterSiteAtual();
    const placa = normalizarPlaca(placaInformada);
    const [[v]] = await pool.query<RowDataPacket[]>(
      `SELECT v.*, c.nome AS categoria FROM veiculos v JOIN categorias_veiculo c ON c.id = v.categoria_id
        WHERE v.site_id = ? AND v.placa = ?`,
      [site.id, placa],
    );
    const [l] = await pool.query<RowDataPacket[]>(
      `${SELECT_MOVIMENTO} WHERE s.site_id = ? AND s.placa = ? ORDER BY s.entrada_em DESC LIMIT 500`,
      [site.id, placa],
    );
    const estadias = l.map(linhaMovimento);
    const [[pago]] = await pool.query<RowDataPacket[]>(
      `SELECT COALESCE(SUM(p.valor_centavos), 0) AS t FROM pagamentos p JOIN sessoes_estacionamento s ON s.id = p.sessao_id
        WHERE s.site_id = ? AND s.placa = ? AND p.status = 'CONFIRMADO'`,
      [site.id, placa],
    );
    const validas = estadias.filter((e) => e.situacao !== 'CANCELADA');
    return {
      placa,
      veiculo: v
        ? {
            categoria: String(v.categoria),
            marca: (v.marca as string | null) ?? null,
            modelo: (v.modelo as string | null) ?? null,
            cor: (v.cor as string | null) ?? null,
            primeiraVisitaEm: iso(v.primeira_visita_em),
          }
        : null,
      resumo: {
        visitas: validas.length,
        totalPagoCentavos: n(pago?.t),
        permanenciaMediaMin: validas.length
          ? Math.round(validas.reduce((s, e) => s + e.permanenciaMin, 0) / validas.length)
          : 0,
        ultimaVisitaEm: validas[0]?.entradaEm ?? null,
      },
      estadias,
    };
  },

  async ocupacao(f: { de: string; ate: string }): Promise<RelatorioOcupacao> {
    const site = await obterSiteAtual();
    const { inicio, fim } = intervalo(f, 92);
    const [[agora]] = await pool.query<RowDataPacket[]>('SELECT NOW(3) AS t');
    const cap = await capacidade(site.id);
    const total = [...cap.values()].reduce((a, b) => a + b, 0);
    const sessoes = await sessoesNoIntervalo(site.id, inicio, fim);
    const geral = calcularOcupacao(sessoes, inicio, fim, agora!.t as Date);

    const porDia = new Map<string, { soma: number; horas: number }>();
    const perfil = Array.from({ length: 24 }, () => ({ soma: 0, horas: 0 }));
    geral.somaHora.forEach((v, h) => {
      const t = new Date(inicio.getTime() + h * HORA);
      const d = porDia.get(diaLocal(t)) ?? { soma: 0, horas: 0 };
      d.soma += v;
      d.horas++;
      porDia.set(diaLocal(t), d);
      const ph = perfil[horaLocal(t)]!;
      ph.soma += v;
      ph.horas++;
    });
    const categorias = [...cap.keys()].sort();
    return {
      capacidade: total,
      porDia: [...porDia].map(([dia, d]) => {
        const media = d.horas ? d.soma / d.horas : 0;
        const p = geral.pico.get(dia);
        return {
          dia,
          mediaOcupadas: Math.round(media * 10) / 10,
          picoOcupadas: p?.valor ?? 0,
          picoEm: p ? new Date(p.em).toISOString() : null,
          taxaMedia: total ? Math.round((media / total) * 1000) / 10 : 0,
        };
      }),
      perfilHorario: perfil.map((x, hora) => ({
        hora,
        mediaOcupadas: x.horas ? Math.round((x.soma / x.horas) * 10) / 10 : 0,
      })),
      porCategoria: categorias.map((categoria) => {
        const c = calcularOcupacao(
          sessoes.filter((s) => s.categoria === categoria),
          inicio,
          fim,
          agora!.t as Date,
        );
        const soma = c.somaHora.reduce((a, b) => a + b, 0);
        return {
          categoria,
          capacidade: cap.get(categoria) ?? 0,
          mediaOcupadas: c.horas ? Math.round((soma / c.horas) * 10) / 10 : 0,
          picoOcupadas: Math.max(0, ...[...c.pico.values()].map((x) => x.valor)),
        };
      }),
    };
  },

  async bloqueios(f: { de: string; ate: string; operadorId?: string }): Promise<RelatorioBloqueios> {
    const site = await obterSiteAtual();
    const { inicio, fim } = intervalo(f);
    const [atuais] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.codigo, v.setor, c.nome AS categoria, v.motivo_bloqueio, v.bloqueada_em,
              COALESCE(fu.nome, u.login) AS por, TIMESTAMPDIFF(DAY, v.bloqueada_em, NOW(3)) AS dias
         FROM vagas v JOIN categorias_veiculo c ON c.id = v.categoria_id
         LEFT JOIN usuarios u ON u.id = v.bloqueada_por LEFT JOIN funcionarios fu ON fu.usuario_id = u.id
        WHERE v.site_id = ? AND v.situacao = 'MANUTENCAO' ORDER BY v.bloqueada_em`,
      [site.id],
    );
    const where = [
      "h.site_id = ? AND h.acao = 'vaga.alterada' AND h.criado_em >= ? AND h.criado_em < ?",
      "NOT (JSON_UNQUOTE(h.dados_anteriores->'$.situacao') <=> JSON_UNQUOTE(h.dados_novos->'$.situacao'))",
      "'MANUTENCAO' IN (JSON_UNQUOTE(h.dados_anteriores->'$.situacao'), JSON_UNQUOTE(h.dados_novos->'$.situacao'))",
    ];
    const p: unknown[] = [site.id, inicio, fim];
    if (f.operadorId) {
      where.push('h.usuario_id = ?');
      p.push(f.operadorId);
    }
    const [hist] = await pool.query<RowDataPacket[]>(
      `SELECT h.criado_em, h.motivo, JSON_UNQUOTE(h.dados_novos->'$.situacao') AS nova,
              JSON_UNQUOTE(h.dados_novos->'$.motivo_bloqueio') AS motivo_bloqueio,
              COALESCE(v.codigo, JSON_UNQUOTE(h.dados_novos->'$.codigo')) AS vaga, COALESCE(fu.nome, u.login) AS usuario
         FROM historico_atividades h
         LEFT JOIN vagas v ON v.id = h.entidade_id
         LEFT JOIN usuarios u ON u.id = h.usuario_id LEFT JOIN funcionarios fu ON fu.usuario_id = u.id
        WHERE ${where.join(' AND ')} ORDER BY h.id DESC LIMIT 500`,
      p,
    );
    return {
      atuais: atuais.map((x) => ({
        id: String(x.id),
        codigo: String(x.codigo),
        setor: (x.setor as string | null) ?? null,
        categoria: String(x.categoria),
        motivo: (x.motivo_bloqueio as string | null) ?? null,
        desde: iso(x.bloqueada_em),
        bloqueadaPor: (x.por as string | null) ?? null,
        diasBloqueada: n(x.dias),
      })),
      historico: hist.map((x) => ({
        em: iso(x.criado_em)!,
        vaga: String(x.vaga ?? '?'),
        acao: x.nova === 'MANUTENCAO' ? 'BLOQUEADA' : 'LIBERADA',
        motivo: ((x.motivo_bloqueio ?? x.motivo) as string | null) ?? null,
        usuario: (x.usuario as string | null) ?? null,
      })),
    };
  },

  async porFuncionario(f: { de: string; ate: string; operadorId?: string }): Promise<MovimentoFuncionario[]> {
    const site = await obterSiteAtual();
    const { inicio, fim } = intervalo(f);
    const p = [site.id, inicio, fim];
    const contar = async (sql: string) => {
      const [l] = await pool.query<RowDataPacket[]>(sql, p);
      return new Map(l.map((x) => [String(x.u), { n: n(x.n), v: n(x.v) }]));
    };
    const [entradas, saidas, cancel, pags, estornos, descontos, caixas] = await Promise.all([
      contar(
        'SELECT operador_entrada_id AS u, COUNT(*) AS n, 0 AS v FROM sessoes_estacionamento WHERE site_id = ? AND entrada_em >= ? AND entrada_em < ? GROUP BY u',
      ),
      contar(
        "SELECT operador_saida_id AS u, COUNT(*) AS n, 0 AS v FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ENCERRADA' AND saida_em >= ? AND saida_em < ? GROUP BY u",
      ),
      contar(
        'SELECT cancelado_por AS u, COUNT(*) AS n, 0 AS v FROM sessoes_estacionamento WHERE site_id = ? AND cancelado_em >= ? AND cancelado_em < ? GROUP BY u',
      ),
      contar(
        'SELECT registrado_por AS u, COUNT(*) AS n, SUM(valor_centavos) AS v FROM pagamentos WHERE site_id = ? AND registrado_em >= ? AND registrado_em < ? GROUP BY u',
      ),
      contar(
        'SELECT estornado_por AS u, COUNT(*) AS n, SUM(valor_centavos) AS v FROM pagamentos WHERE site_id = ? AND estornado_em >= ? AND estornado_em < ? GROUP BY u',
      ),
      contar(
        "SELECT operador_saida_id AS u, COUNT(*) AS n, SUM(desconto_centavos) AS v FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ENCERRADA' AND desconto_centavos > 0 AND saida_em >= ? AND saida_em < ? GROUP BY u",
      ),
      contar(
        'SELECT operador_id AS u, COUNT(*) AS n, 0 AS v FROM caixa_sessoes WHERE site_id = ? AND aberto_em >= ? AND aberto_em < ? GROUP BY u',
      ),
    ]);
    const ids = new Set([
      ...entradas.keys(),
      ...saidas.keys(),
      ...cancel.keys(),
      ...pags.keys(),
      ...estornos.keys(),
      ...caixas.keys(),
    ]);
    ids.delete('null');
    if (f.operadorId) for (const i of [...ids]) if (i !== f.operadorId) ids.delete(i);
    if (!ids.size) return [];
    const [nomes] = await pool.query<RowDataPacket[]>(
      'SELECT u.id, COALESCE(f.nome, u.login) AS nome FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id IN (?)',
      [[...ids]],
    );
    const nome = new Map(nomes.map((x) => [String(x.id), String(x.nome)]));
    // Pagamentos: só os que continuam confirmados contam como recebido
    const [conf] = await pool.query<RowDataPacket[]>(
      "SELECT registrado_por AS u, SUM(valor_centavos) AS v FROM pagamentos WHERE site_id = ? AND registrado_em >= ? AND registrado_em < ? AND status = 'CONFIRMADO' GROUP BY u",
      p,
    );
    const recebido = new Map(conf.map((x) => [String(x.u), n(x.v)]));
    return [...ids]
      .map((u) => ({
        usuarioId: u,
        nome: nome.get(u) ?? '?',
        entradas: entradas.get(u)?.n ?? 0,
        saidas: saidas.get(u)?.n ?? 0,
        cancelamentos: cancel.get(u)?.n ?? 0,
        pagamentos: pags.get(u)?.n ?? 0,
        recebidoCentavos: recebido.get(u) ?? 0,
        estornos: estornos.get(u)?.n ?? 0,
        descontosCentavos: descontos.get(u)?.v ?? 0,
        caixasAbertos: caixas.get(u)?.n ?? 0,
      }))
      .sort((a, b) => b.entradas + b.saidas - (a.entradas + a.saidas));
  },

  async indicadores(f: { de: string; ate: string }): Promise<IndicadoresOperacionais> {
    const site = await obterSiteAtual();
    const { inicio, fim, dias } = intervalo(f, 92);
    const [[agora]] = await pool.query<RowDataPacket[]>('SELECT NOW(3) AS t');
    const [[t]] = await pool.query<RowDataPacket[]>(
      `SELECT SUM(entrada_em >= ? AND entrada_em < ?) AS entradas,
              SUM(status = 'ENCERRADA' AND saida_em >= ? AND saida_em < ?) AS saidas,
              SUM(status = 'CANCELADA' AND entrada_em >= ? AND entrada_em < ?) AS cancelados,
              SUM(status = 'ENCERRADA' AND saida_em >= ? AND saida_em < ? AND valor_final_centavos = 0) AS gratis,
              SUM(IF(status = 'ENCERRADA' AND saida_em >= ? AND saida_em < ?, valor_final_centavos, 0)) AS receita,
              SUM(status = 'ENCERRADA' AND saida_em >= ? AND saida_em < ? AND valor_final_centavos > 0) AS pagantes,
              SUM(status = 'ABERTA') AS agora
         FROM sessoes_estacionamento WHERE site_id = ?`,
      [inicio, fim, inicio, fim, inicio, fim, inicio, fim, inicio, fim, inicio, fim, site.id],
    );
    const [perm] = await pool.query<RowDataPacket[]>(
      `SELECT TIMESTAMPDIFF(MINUTE, s.entrada_em, s.saida_em) AS m, c.nome AS categoria FROM sessoes_estacionamento s
         JOIN categorias_veiculo c ON c.id = s.categoria_id
        WHERE s.site_id = ? AND s.status = 'ENCERRADA' AND s.saida_em >= ? AND s.saida_em < ?`,
      [site.id, inicio, fim],
    );
    const minutos = perm.map((x) => n(x.m)).sort((a, b) => a - b);
    const mediana = minutos.length
      ? minutos.length % 2
        ? minutos[(minutos.length - 1) / 2]!
        : Math.round((minutos[minutos.length / 2 - 1]! + minutos[minutos.length / 2]!) / 2)
      : 0;
    const cap = await capacidade(site.id);
    const total = [...cap.values()].reduce((a, b) => a + b, 0);
    const o = calcularOcupacao(await sessoesNoIntervalo(site.id, inicio, fim), inicio, fim, agora!.t as Date);
    const somaTotal = o.somaHora.reduce((a, b) => a + b, 0);
    const perfil = new Array<{ soma: number; horas: number }>(24)
      .fill({ soma: 0, horas: 0 })
      .map(() => ({ soma: 0, horas: 0 }));
    o.somaHora.forEach((v, h) => {
      const x = perfil[horaLocal(new Date(inicio.getTime() + h * HORA))]!;
      x.soma += v;
      x.horas++;
    });
    const medias = perfil.map((x) => (x.horas ? x.soma / x.horas : 0));
    const horaDePico = somaTotal > 0 ? medias.indexOf(Math.max(...medias)) : null;
    const picoGeral = Math.max(0, ...[...o.pico.values()].map((x) => x.valor));
    const [[bloq]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM vagas WHERE site_id = ? AND situacao = 'MANUTENCAO'",
      [site.id],
    );
    const porCat = new Map<string, { entradas: number; soma: number; n: number }>();
    for (const x of perm) {
      const c = porCat.get(String(x.categoria)) ?? { entradas: 0, soma: 0, n: 0 };
      c.soma += n(x.m);
      c.n++;
      porCat.set(String(x.categoria), c);
    }
    const [ent] = await pool.query<RowDataPacket[]>(
      `SELECT c.nome AS categoria, COUNT(*) AS n FROM sessoes_estacionamento s JOIN categorias_veiculo c ON c.id = s.categoria_id
        WHERE s.site_id = ? AND s.entrada_em >= ? AND s.entrada_em < ? AND s.status <> 'CANCELADA' GROUP BY c.nome`,
      [site.id, inicio, fim],
    );
    for (const x of ent) {
      const c = porCat.get(String(x.categoria)) ?? { entradas: 0, soma: 0, n: 0 };
      c.entradas = n(x.n);
      porCat.set(String(x.categoria), c);
    }
    const saidas = n(t?.saidas);
    const entradas = n(t?.entradas);
    const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
    return {
      periodo: { de: f.de, ate: f.ate, dias },
      entradas,
      saidas,
      cancelamentos: n(t?.cancelados),
      taxaCancelamento: pct(n(t?.cancelados), entradas),
      entradasPorDia: Math.round((entradas / dias) * 10) / 10,
      permanenciaMediaMin: minutos.length
        ? Math.round(minutos.reduce((a, b) => a + b, 0) / minutos.length)
        : 0,
      permanenciaMedianaMin: mediana,
      dentroDaToleranciaPct: pct(n(t?.gratis), saidas),
      rotatividade: total ? Math.round((saidas / total / dias) * 100) / 100 : 0,
      ocupacaoMediaPct: o.horas && total ? pct(somaTotal / o.horas, total) : 0,
      ocupacaoPicoPct: pct(picoGeral, total),
      horaDePico,
      ticketMedioCentavos: n(t?.pagantes) ? Math.round(n(t?.receita) / n(t?.pagantes)) : 0,
      receitaPorVagaDiaCentavos: total ? Math.round(n(t?.receita) / total / dias) : 0,
      vagasBloqueadasAgora: n(bloq?.n),
      veiculosAgora: n(t?.agora),
      porCategoria: [...porCat].map(([categoria, c]) => ({
        categoria,
        entradas: c.entradas,
        permanenciaMediaMin: c.n ? Math.round(c.soma / c.n) : 0,
      })),
    };
  },
};
