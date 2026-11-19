import type { RowDataPacket } from 'mysql2/promise';
import {
  calcularTarifa,
  formatarCentavos,
  minutosDePermanencia,
  type Modalidade,
  type PagamentoResumo,
  type RegraTarifa,
  type SessaoDetalhe,
} from '@estacionamento/shared';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export interface RegraVigente {
  id: string;
  regra: RegraTarifa;
}

export function regraDaLinha(l: RowDataPacket): RegraTarifa {
  return {
    toleranciaMin: n(l.tolerancia_min),
    primeiraHoraCentavos: n(l.primeira_hora_centavos),
    horaAdicionalCentavos: n(l.hora_adicional_centavos),
    fracaoMin: nulo(l.fracao_min),
    fracaoCentavos: nulo(l.fracao_centavos),
    diariaMaximaCentavos: nulo(l.diaria_maxima_centavos),
    diariaCentavos: nulo(l.diaria_centavos),
  };
}

/** Texto curto da tarifa aplicada, para o operador conferir. */
export function descreverTarifa(r: RegraTarifa, modalidade: Modalidade): string {
  if (modalidade === 'DIARIA') return `Diária ${formatarCentavos(r.diariaCentavos ?? 0)} por 24h`;
  const partes = [
    `1ª hora ${formatarCentavos(r.primeiraHoraCentavos)}`,
    `hora adicional ${formatarCentavos(r.horaAdicionalCentavos)}`,
  ];
  if (r.fracaoMin && r.fracaoCentavos !== null)
    partes.push(`fração de ${r.fracaoMin} min ${formatarCentavos(r.fracaoCentavos)}`);
  if (r.diariaMaximaCentavos !== null) partes.push(`máximo ${formatarCentavos(r.diariaMaximaCentavos)}/24h`);
  if (r.toleranciaMin > 0) partes.push(`tolerância ${r.toleranciaMin} min`);
  return partes.join(' · ');
}

const SELECT_SESSAO = `
  SELECT s.id, s.numero, s.status, s.placa, s.veiculo_id, s.categoria_id, c.nome AS categoria, s.vaga_id, v.codigo AS vaga,
         s.modalidade, s.entrada_em, s.saida_em, s.cancelado_em, s.valor_final_centavos, s.versao,
         (SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = s.operador_entrada_id) AS operador_entrada,
         (SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = s.operador_saida_id) AS operador_saida,
         r.tolerancia_min, r.primeira_hora_centavos, r.hora_adicional_centavos, r.fracao_min, r.fracao_centavos,
         r.diaria_maxima_centavos, r.diaria_centavos,
         NOW(3) AS agora
    FROM sessoes_estacionamento s
    JOIN categorias_veiculo c ON c.id = s.categoria_id
    JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
    LEFT JOIN vagas v ON v.id = s.vaga_id`;

async function pagamentosDaSessao(c: Conexao | typeof pool, sessaoId: string): Promise<PagamentoResumo[]> {
  const [linhas] = await c.query<RowDataPacket[]>(
    `SELECT p.id, p.forma_codigo, f.nome, p.valor_centavos, p.valor_recebido_centavos, p.troco_centavos, p.status, p.registrado_em
       FROM pagamentos p JOIN formas_pagamento f ON f.codigo = p.forma_codigo
      WHERE p.sessao_id = ? ORDER BY p.registrado_em`,
    [sessaoId],
  );
  return linhas.map((l) => ({
    id: l.id,
    forma: l.forma_codigo,
    formaNome: l.nome,
    valorCentavos: n(l.valor_centavos),
    valorRecebidoCentavos: nulo(l.valor_recebido_centavos),
    trocoCentavos: n(l.troco_centavos),
    status: l.status,
    registradoEm: iso(l.registrado_em) ?? '',
  }));
}

async function montar(c: Conexao | typeof pool, l: RowDataPacket): Promise<SessaoDetalhe> {
  const regra = regraDaLinha(l);
  const pagamentos = await pagamentosDaSessao(c, l.id);
  const pago = pagamentos.filter((p) => p.status === 'CONFIRMADO').reduce((s, p) => s + p.valorCentavos, 0);
  const fim = (l.saida_em ?? l.cancelado_em ?? l.agora) as Date;
  const minutos = minutosDePermanencia(l.entrada_em as Date, fim);
  const calculado =
    l.status === 'ENCERRADA'
      ? n(l.valor_final_centavos)
      : l.status === 'CANCELADA'
        ? 0
        : calcularTarifa(regra, minutos, l.modalidade);
  return {
    id: l.id,
    numero: String(l.numero),
    status: l.status,
    placa: l.placa,
    veiculoId: l.veiculo_id,
    categoriaId: l.categoria_id,
    categoria: l.categoria,
    vagaId: l.vaga_id ?? null,
    vaga: l.vaga ?? null,
    modalidade: l.modalidade,
    entradaEm: iso(l.entrada_em) ?? '',
    saidaEm: iso(l.saida_em),
    operadorEntrada: l.operador_entrada ?? null,
    operadorSaida: l.operador_saida ?? null,
    valorFinalCentavos: nulo(l.valor_final_centavos),
    versao: n(l.versao),
    pagamentos,
    calculo: {
      calculadoEm: iso(fim) ?? '',
      permanenciaMin: minutos,
      valorCalculadoCentavos: calculado,
      pagoCentavos: pago,
      aPagarCentavos: Math.max(0, calculado - pago),
      tarifa: descreverTarifa(regra, l.modalidade),
    },
  };
}

export const sessoesRepository = {
  async buscarPorId(siteId: string, id: string, c?: Conexao, travar = false): Promise<SessaoDetalhe | null> {
    const [[l]] = await (c ?? pool).query<RowDataPacket[]>(
      `${SELECT_SESSAO} WHERE s.site_id = ? AND s.id = ?${travar ? ' FOR UPDATE OF s' : ''}`,
      [siteId, id],
    );
    return l ? montar(c ?? pool, l) : null;
  },

  async buscarPorNumero(siteId: string, numero: number): Promise<SessaoDetalhe | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(`${SELECT_SESSAO} WHERE s.site_id = ? AND s.numero = ?`, [
      siteId,
      numero,
    ]);
    return l ? montar(pool, l) : null;
  },

  /** Sessão aberta da placa ou, se não houver, a última encerrada/cancelada (para avisar). */
  async buscarPorPlaca(siteId: string, placa: string): Promise<SessaoDetalhe | null> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `${SELECT_SESSAO} WHERE s.site_id = ? AND s.placa = ? ORDER BY s.status = 'ABERTA' DESC, s.entrada_em DESC LIMIT 1`,
      [siteId, placa],
    );
    return l ? montar(pool, l) : null;
  },

  async abertas(siteId: string): Promise<SessaoDetalhe[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `${SELECT_SESSAO} WHERE s.site_id = ? AND s.status = 'ABERTA' ORDER BY s.entrada_em DESC`,
      [siteId],
    );
    return Promise.all(linhas.map((l) => montar(pool, l)));
  },

  /** Regra da tabela de tarifas VIGENTE para a categoria (ou null). */
  async regraVigente(c: Conexao, siteId: string, categoriaId: string): Promise<RegraVigente | null> {
    const [[l]] = await c.query<RowDataPacket[]>(
      `SELECT r.* FROM tarifa_regras r
        WHERE r.categoria_id = ?
          AND r.tabela_id = (SELECT t.id FROM tabelas_tarifa t
                              WHERE t.site_id = ? AND t.status = 'PUBLICADA' AND t.vigente_desde <= NOW(3)
                              ORDER BY t.vigente_desde DESC, t.versao DESC LIMIT 1)`,
      [categoriaId, siteId],
    );
    return l ? { id: String(l.id), regra: regraDaLinha(l) } : null;
  },

  /**
   * Primeira vaga livre da categoria (por setor e código), travada.
   * SKIP LOCKED: duas entradas simultâneas recebem vagas diferentes.
   */
  /**
   * Trava a primeira vaga livre da categoria. Vagas travadas por outra entrada em
   * andamento são puladas (SKIP LOCKED). Depois de travar, confere a ocupação com
   * leitura atual (FOR SHARE): a lista inicial vem da "fotografia" da transação e
   * pode não enxergar uma entrada que acabou de ser gravada por outro guichê.
   */
  async travarVagaLivre(
    c: Conexao,
    siteId: string,
    categoriaId: string,
  ): Promise<{ id: string; codigo: string } | null> {
    const descartadas: string[] = [];
    for (;;) {
      const [[l]] = await c.query<RowDataPacket[]>(
        `SELECT v.id, v.codigo FROM vagas v
          WHERE v.site_id = ? AND v.categoria_id = ? AND v.situacao = 'ATIVA'
            AND NOT EXISTS (SELECT 1 FROM sessoes_estacionamento s WHERE s.vaga_ocupada_id = v.id)
            ${descartadas.length ? 'AND v.id NOT IN (?)' : ''}
          ORDER BY v.setor, LENGTH(v.codigo), v.codigo
          LIMIT 1 FOR UPDATE OF v SKIP LOCKED`,
        descartadas.length ? [siteId, categoriaId, descartadas] : [siteId, categoriaId],
      );
      if (!l) return null;
      const [ocupacao] = await c.query<RowDataPacket[]>(
        'SELECT 1 FROM sessoes_estacionamento WHERE vaga_ocupada_id = ? FOR SHARE',
        [l.id],
      );
      if (ocupacao.length === 0) return { id: String(l.id), codigo: String(l.codigo) };
      descartadas.push(String(l.id));
    }
  },

  async travarVaga(c: Conexao, siteId: string, vagaId: string) {
    const [[l]] = await c.query<RowDataPacket[]>(
      `SELECT v.id, v.codigo, v.categoria_id, v.situacao, c.nome AS categoria,
              (SELECT s.placa FROM sessoes_estacionamento s WHERE s.vaga_ocupada_id = v.id) AS ocupada_por
         FROM vagas v JOIN categorias_veiculo c ON c.id = v.categoria_id
        WHERE v.site_id = ? AND v.id = ? FOR UPDATE OF v`,
      [siteId, vagaId],
    );
    return l
      ? {
          id: String(l.id),
          codigo: String(l.codigo),
          categoriaId: String(l.categoria_id),
          categoria: String(l.categoria),
          situacao: String(l.situacao),
          ocupadaPor: (l.ocupada_por as string | null) ?? null,
        }
      : null;
  },

  async vagasLivres(siteId: string, categoriaId: string) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT v.id, v.codigo, v.setor FROM vagas v
        WHERE v.site_id = ? AND v.categoria_id = ? AND v.situacao = 'ATIVA'
          AND NOT EXISTS (SELECT 1 FROM sessoes_estacionamento s WHERE s.vaga_ocupada_id = v.id)
        ORDER BY v.setor, LENGTH(v.codigo), v.codigo`,
      [siteId, categoriaId],
    );
    return linhas.map((l) => ({
      id: String(l.id),
      codigo: String(l.codigo),
      setor: (l.setor as string | null) ?? null,
    }));
  },

  async proximoNumero(c: Conexao, siteId: string): Promise<number> {
    await c.query("INSERT IGNORE INTO sequencias (site_id, nome, proximo_valor) VALUES (?, 'ticket', 1)", [
      siteId,
    ]);
    const [[l]] = await c.query<RowDataPacket[]>(
      "SELECT proximo_valor FROM sequencias WHERE site_id = ? AND nome = 'ticket' FOR UPDATE",
      [siteId],
    );
    const numero = n(l?.proximo_valor) || 1;
    await c.query("UPDATE sequencias SET proximo_valor = ? WHERE site_id = ? AND nome = 'ticket'", [
      numero + 1,
      siteId,
    ]);
    return numero;
  },

  async caixaAbertoDoOperador(c: Conexao | typeof pool, operadorId: string) {
    const [[l]] = await c.query<RowDataPacket[]>(
      `SELECT cx.id, cx.posto_id, p.nome AS posto, cx.aberto_em, cx.saldo_inicial_centavos
         FROM caixa_sessoes cx JOIN postos p ON p.id = cx.posto_id
        WHERE cx.operador_aberto_id = ?`,
      [operadorId],
    );
    return l
      ? {
          id: String(l.id),
          postoId: String(l.posto_id),
          posto: String(l.posto),
          abertoEm: l.aberto_em as Date,
          saldoInicial: n(l.saldo_inicial_centavos),
        }
      : null;
  },

  async formasAtivas(
    c: Conexao,
  ): Promise<Map<string, { nome: string; permiteTroco: boolean; permiteParcelas: boolean }>> {
    const [linhas] = await c.query<RowDataPacket[]>(
      'SELECT codigo, nome, permite_troco, permite_parcelas FROM formas_pagamento WHERE ativo = TRUE',
    );
    return new Map(
      linhas.map((l) => [
        String(l.codigo),
        {
          nome: String(l.nome),
          permiteTroco: Boolean(Number(l.permite_troco)),
          permiteParcelas: Boolean(Number(l.permite_parcelas)),
        },
      ]),
    );
  },
};
