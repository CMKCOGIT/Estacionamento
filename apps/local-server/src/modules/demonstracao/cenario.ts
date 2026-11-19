import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { calcularTarifa, minutosDePermanencia, type RegraTarifa } from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';

/**
 * Operações de baixo nível para montar cenários reais no banco (testes de
 * integração e banco de DEMONSTRAÇÃO). Passam por todas as regras do banco
 * (triggers e CHECKs). NÃO são os módulos de negócio: as telas de entrada,
 * saída e caixa terão seus próprios serviços.
 */

export const REGRA_CARRO: RegraTarifa = {
  toleranciaMin: 10,
  primeiraHoraCentavos: 1000,
  horaAdicionalCentavos: 600,
  fracaoMin: 15,
  fracaoCentavos: 200,
  diariaMaximaCentavos: 4000,
  diariaCentavos: 3500,
};

export const REGRA_MOTO: RegraTarifa = {
  toleranciaMin: 10,
  primeiraHoraCentavos: 500,
  horaAdicionalCentavos: 300,
  fracaoMin: null,
  fracaoCentavos: null,
  diariaMaximaCentavos: 2000,
  diariaCentavos: 1800,
};

export interface CadastrosBase {
  categorias: { carro: string; moto: string };
  vagas: { carro: string[]; moto: string[] };
  regras: { carro: string; moto: string };
  regrasValores: { carro: RegraTarifa; moto: RegraTarifa };
  postoId: string;
}

/** Categorias, vagas, posto e uma tabela de tarifas PUBLICADA desde `vigenteDesde`. */
export async function criarCadastrosBase(
  c: Conexao,
  o: {
    siteId: string;
    usuarioId: string;
    vagasCarro: number;
    vagasMoto: number;
    vigenteDesde: Date;
    manutencao?: number;
  },
): Promise<CadastrosBase> {
  const carro = ulid();
  const moto = ulid();
  await c.query(
    'INSERT INTO categorias_veiculo (id, site_id, codigo, nome, ordem) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 2)',
    [carro, o.siteId, 'CARRO', 'Carro', moto, o.siteId, 'MOTO', 'Moto'],
  );

  const vagas = { carro: [] as string[], moto: [] as string[] };
  const linhas: unknown[][] = [];
  for (let i = 1; i <= o.vagasCarro; i++) {
    const id = ulid();
    vagas.carro.push(id);
    linhas.push([
      id,
      o.siteId,
      `A-${String(i).padStart(2, '0')}`,
      i <= 15 ? 'Térreo' : 'Subsolo',
      carro,
      i <= (o.manutencao ?? 0) ? 'MANUTENCAO' : 'ATIVA',
    ]);
  }
  for (let i = 1; i <= o.vagasMoto; i++) {
    const id = ulid();
    vagas.moto.push(id);
    linhas.push([id, o.siteId, `M-${String(i).padStart(2, '0')}`, 'Motos', moto, 'ATIVA']);
  }
  await c.query('INSERT INTO vagas (id, site_id, codigo, setor, categoria_id, situacao) VALUES ?', [linhas]);
  // A manutenção fica nas primeiras vagas de carro; quem usa o cenário escolhe as outras.
  vagas.carro = [...vagas.carro.slice(o.manutencao ?? 0), ...vagas.carro.slice(0, o.manutencao ?? 0)];

  const postoId = ulid();
  await c.query("INSERT INTO postos (id, site_id, nome, tipo) VALUES (?, ?, 'Guichê 1', 'GUICHE')", [
    postoId,
    o.siteId,
  ]);

  const tabela = ulid();
  const [[v]] = await c.query<RowDataPacket[]>(
    'SELECT COALESCE(MAX(versao), 0) + 1 AS v FROM tabelas_tarifa WHERE site_id = ?',
    [o.siteId],
  );
  await c.query('INSERT INTO tabelas_tarifa (id, site_id, versao, nome, criado_por) VALUES (?, ?, ?, ?, ?)', [
    tabela,
    o.siteId,
    v?.v,
    'Tabela padrão',
    o.usuarioId,
  ]);
  const regras = { carro: ulid(), moto: ulid() };
  for (const [id, cat, r] of [
    [regras.carro, carro, REGRA_CARRO],
    [regras.moto, moto, REGRA_MOTO],
  ] as const) {
    await c.query(
      `INSERT INTO tarifa_regras (id, tabela_id, categoria_id, tolerancia_min, primeira_hora_centavos, hora_adicional_centavos,
                                  fracao_min, fracao_centavos, diaria_maxima_centavos, diaria_centavos)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        tabela,
        cat,
        r.toleranciaMin,
        r.primeiraHoraCentavos,
        r.horaAdicionalCentavos,
        r.fracaoMin,
        r.fracaoCentavos,
        r.diariaMaximaCentavos,
        r.diariaCentavos,
      ],
    );
  }
  await c.query(
    "UPDATE tabelas_tarifa SET status = 'PUBLICADA', vigente_desde = ?, publicado_em = ?, publicado_por = ? WHERE id = ?",
    [o.vigenteDesde, o.vigenteDesde, o.usuarioId, tabela],
  );
  return {
    categorias: { carro, moto },
    vagas,
    regras,
    regrasValores: { carro: REGRA_CARRO, moto: REGRA_MOTO },
    postoId,
  };
}

export async function abrirCaixa(
  c: Conexao,
  o: { siteId: string; postoId: string; operadorId: string; em: Date; saldoInicial: number },
) {
  const id = ulid();
  await c.query(
    'INSERT INTO caixa_sessoes (id, site_id, posto_id, operador_id, aberto_em, saldo_inicial_centavos) VALUES (?, ?, ?, ?, ?, ?)',
    [id, o.siteId, o.postoId, o.operadorId, o.em, o.saldoInicial],
  );
  if (o.saldoInicial > 0) {
    await c.query(
      "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, registrado_por, registrado_em) VALUES (?, ?, ?, 'ABERTURA', 'ENTRADA', ?, 'DINHEIRO', ?, ?)",
      [ulid(), o.siteId, id, o.saldoInicial, o.operadorId, o.em],
    );
  }
  return id;
}

export async function fecharCaixa(c: Conexao, o: { caixaId: string; em: Date; operadorId: string }) {
  const [[l]] = await c.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(saldo_centavos), 0) AS s FROM vw_caixa_resumo WHERE caixa_sessao_id = ? AND forma_codigo = 'DINHEIRO'",
    [o.caixaId],
  );
  const esperado = Number(l?.s ?? 0);
  await c.query(
    "UPDATE caixa_sessoes SET status = 'FECHADO', fechado_em = ?, fechado_por = ?, saldo_esperado_centavos = ?, saldo_contado_centavos = ?, diferenca_centavos = 0 WHERE id = ?",
    [o.em, o.operadorId, esperado, esperado, o.caixaId],
  );
}

/** Próximo número de ticket do site (tabela sequencias, com trava). */
export async function proximoNumero(c: Conexao, siteId: string): Promise<number> {
  await c.query("INSERT IGNORE INTO sequencias (site_id, nome, proximo_valor) VALUES (?, 'ticket', 1)", [
    siteId,
  ]);
  const [[l]] = await c.query<RowDataPacket[]>(
    "SELECT proximo_valor FROM sequencias WHERE site_id = ? AND nome = 'ticket' FOR UPDATE",
    [siteId],
  );
  const numero = Number(l?.proximo_valor ?? 1);
  await c.query("UPDATE sequencias SET proximo_valor = ? WHERE site_id = ? AND nome = 'ticket'", [
    numero + 1,
    siteId,
  ]);
  return numero;
}

export async function registrarEntrada(
  c: Conexao,
  o: {
    siteId: string;
    placa: string;
    categoriaId: string;
    vagaId: string | null;
    regraId: string;
    operadorId: string;
    postoId: string;
    em: Date;
    modalidade?: 'AVULSO' | 'DIARIA';
  },
): Promise<string> {
  await c.query(
    'INSERT INTO veiculos (id, site_id, placa, categoria_id, primeira_visita_em, ultima_visita_em) VALUES (?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE ultima_visita_em = VALUES(ultima_visita_em)',
    [ulid(), o.siteId, o.placa, o.categoriaId, o.em, o.em],
  );
  const [[v]] = await c.query<RowDataPacket[]>('SELECT id FROM veiculos WHERE site_id = ? AND placa = ?', [
    o.siteId,
    o.placa,
  ]);
  const id = ulid();
  await c.query(
    `INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, modalidade,
                                         entrada_em, operador_entrada_id, posto_entrada_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      o.siteId,
      await proximoNumero(c, o.siteId),
      v?.id,
      o.placa,
      o.categoriaId,
      o.vagaId,
      o.regraId,
      o.modalidade ?? 'AVULSO',
      o.em,
      o.operadorId,
      o.postoId,
    ],
  );
  return id;
}

export async function registrarPagamento(
  c: Conexao,
  o: {
    siteId: string;
    sessaoId: string;
    caixaId: string;
    forma: string;
    valor: number;
    recebido?: number;
    operadorId: string;
    em: Date;
  },
) {
  const id = ulid();
  const troco = o.recebido !== undefined ? o.recebido - o.valor : 0;
  await c.query(
    `INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos, troco_centavos,
                             autorizacao, chave_idempotencia, registrado_por, registrado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UUID(), ?, ?)`,
    [
      id,
      o.siteId,
      o.sessaoId,
      o.caixaId,
      o.forma,
      o.valor,
      o.recebido ?? null,
      troco,
      o.forma === 'DINHEIRO' ? null : `AUT${id.slice(-6)}`,
      o.operadorId,
      o.em,
    ],
  );
  await c.query(
    "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em) VALUES (?, ?, ?, 'RECEBIMENTO', 'ENTRADA', ?, ?, ?, ?, ?, ?)",
    [ulid(), o.siteId, o.caixaId, o.valor, o.forma, id, o.sessaoId, o.operadorId, o.em],
  );
  return id;
}

export async function estornarPagamento(
  c: Conexao,
  o: { siteId: string; pagamentoId: string; caixaId: string; operadorId: string; em: Date; motivo: string },
) {
  const [[p]] = await c.query<RowDataPacket[]>(
    'SELECT valor_centavos, forma_codigo, sessao_id FROM pagamentos WHERE id = ?',
    [o.pagamentoId],
  );
  await c.query(
    "UPDATE pagamentos SET status = 'ESTORNADO', estornado_em = ?, estornado_por = ?, motivo_estorno = ? WHERE id = ?",
    [o.em, o.operadorId, o.motivo, o.pagamentoId],
  );
  await c.query(
    "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em) VALUES (?, ?, ?, 'ESTORNO', 'SAIDA', ?, ?, ?, ?, ?, ?)",
    [
      ulid(),
      o.siteId,
      o.caixaId,
      p?.valor_centavos,
      p?.forma_codigo,
      o.pagamentoId,
      p?.sessao_id,
      o.operadorId,
      o.em,
    ],
  );
}

/** Calcula o valor, registra o pagamento (se houver valor) e encerra a sessão. */
export async function registrarSaida(
  c: Conexao,
  o: {
    siteId: string;
    sessaoId: string;
    regra: RegraTarifa;
    entradaEm: Date;
    em: Date;
    caixaId: string;
    forma: string;
    operadorId: string;
    postoId: string;
    modalidade?: 'AVULSO' | 'DIARIA';
  },
): Promise<number> {
  const valor = calcularTarifa(o.regra, minutosDePermanencia(o.entradaEm, o.em), o.modalidade ?? 'AVULSO');
  const [[pago]] = await c.query<RowDataPacket[]>(
    "SELECT COALESCE(SUM(valor_centavos), 0) AS t FROM pagamentos WHERE sessao_id = ? AND status = 'CONFIRMADO'",
    [o.sessaoId],
  );
  const falta = valor - Number(pago?.t ?? 0);
  if (falta > 0) {
    const recebido = o.forma === 'DINHEIRO' ? Math.ceil(falta / 500) * 500 : undefined;
    await registrarPagamento(c, {
      siteId: o.siteId,
      sessaoId: o.sessaoId,
      caixaId: o.caixaId,
      forma: o.forma,
      valor: falta,
      recebido,
      operadorId: o.operadorId,
      em: o.em,
    });
  }
  await c.query(
    `UPDATE sessoes_estacionamento
        SET status = 'ENCERRADA', saida_em = ?, operador_saida_id = ?, posto_saida_id = ?,
            valor_calculado_centavos = ?, valor_final_centavos = ?
      WHERE id = ?`,
    [o.em, o.operadorId, o.postoId, valor, valor, o.sessaoId],
  );
  return valor;
}

export async function cancelarSessao(
  c: Conexao,
  o: { sessaoId: string; em: Date; operadorId: string; motivo: string },
) {
  await c.query(
    "UPDATE sessoes_estacionamento SET status = 'CANCELADA', cancelado_em = ?, cancelado_por = ?, motivo_cancelamento = ? WHERE id = ?",
    [o.em, o.operadorId, o.motivo, o.sessaoId],
  );
}
