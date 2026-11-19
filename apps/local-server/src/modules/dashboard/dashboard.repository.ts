import type { RowDataPacket } from 'mysql2/promise';
import type { Modalidade, Movimento, RegraTarifa } from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { pool } from '../../db/pool.js';

/**
 * Consultas do Dashboard. Todas leem dados reais do banco local.
 * "Hoje" = dia corrente no fuso do estacionamento (env.FUSO_OFFSET).
 */
const FUSO = env.FUSO_OFFSET;
/** Início do dia local de hoje, em UTC (os horários estão gravados em UTC). */
const INICIO_HOJE = `CONVERT_TZ(DATE(CONVERT_TZ(NOW(3), '+00:00', '${FUSO}')), '${FUSO}', '+00:00')`;
const DIA_LOCAL = (coluna: string) => `DATE(CONVERT_TZ(${coluna}, '+00:00', '${FUSO}'))`;

const n = (v: unknown) => Number(v ?? 0);

export interface SessaoAbertaParaCalculo {
  entradaEm: Date;
  modalidade: Modalidade;
  regra: RegraTarifa;
  pagoCentavos: number;
}

export const dashboardRepository = {
  async agora(): Promise<Date> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT NOW(3) AS agora');
    return l?.agora as Date;
  },

  async ocupacaoPorCategoria(siteId: string) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT categoria_id, categoria_codigo, categoria_nome, capacidade_total, em_manutencao, ocupadas, livres
         FROM vw_ocupacao_categoria WHERE site_id = ? ORDER BY categoria_nome`,
      [siteId],
    );
    return linhas.map((l) => ({
      categoriaId: String(l.categoria_id),
      codigo: String(l.categoria_codigo),
      nome: String(l.categoria_nome),
      total: n(l.capacidade_total),
      disponiveis: Math.max(0, n(l.livres)),
      ocupadas: n(l.ocupadas),
      bloqueadas: n(l.em_manutencao),
    }));
  },

  async veiculosEstacionados(siteId: string): Promise<number> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ABERTA'",
      [siteId],
    );
    return n(l?.n);
  },

  /** Sessões não canceladas que estiveram abertas em algum momento das últimas 24h. */
  async sessoesNaJanela(siteId: string, desde: Date): Promise<{ entrada: Date; saida: Date | null }[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT entrada_em, saida_em FROM sessoes_estacionamento
        WHERE site_id = ? AND status <> 'CANCELADA'
          AND entrada_em <= NOW(3) AND (saida_em IS NULL OR saida_em >= ?)`,
      [siteId, desde],
    );
    return linhas.map((l) => ({ entrada: l.entrada_em as Date, saida: (l.saida_em as Date | null) ?? null }));
  },

  async movimentoHoje(siteId: string) {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM sessoes_estacionamento WHERE site_id = ? AND entrada_em >= ${INICIO_HOJE}) AS entradas,
         (SELECT COUNT(*) FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ENCERRADA' AND saida_em >= ${INICIO_HOJE}) AS saidas,
         (SELECT COUNT(*) FROM sessoes_estacionamento WHERE site_id = ? AND status = 'CANCELADA' AND cancelado_em >= ${INICIO_HOJE}) AS cancelamentos,
         (SELECT AVG(TIMESTAMPDIFF(MINUTE, entrada_em, saida_em)) FROM sessoes_estacionamento
           WHERE site_id = ? AND status = 'ENCERRADA' AND saida_em >= ${INICIO_HOJE}) AS permanencia_media`,
      [siteId, siteId, siteId, siteId],
    );
    return {
      entradas: n(l?.entradas),
      saidas: n(l?.saidas),
      cancelamentos: n(l?.cancelamentos),
      permanenciaMediaMin:
        l?.permanencia_media === null || l?.permanencia_media === undefined
          ? null
          : Math.round(n(l.permanencia_media)),
    };
  },

  /** Últimas entradas, saídas e cancelamentos, do mais recente para o mais antigo. */
  async ultimosMovimentos(siteId: string, limite: number): Promise<Movimento[]> {
    const base = `
      FROM sessoes_estacionamento s
      JOIN categorias_veiculo c ON c.id = s.categoria_id
      LEFT JOIN vagas v ON v.id = s.vaga_id`;
    const operador = (col: string) =>
      `(SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = ${col})`;
    const [linhas] = await pool.query<RowDataPacket[]>(
      `(SELECT 'ENTRADA' AS tipo, s.entrada_em AS em, s.id, s.numero, s.placa, v.codigo AS vaga, c.nome AS categoria,
               ${operador('s.operador_entrada_id')} AS operador, NULL AS valor, NULL AS permanencia
          ${base} WHERE s.site_id = ? ORDER BY s.entrada_em DESC LIMIT ?)
       UNION ALL
       (SELECT 'SAIDA', s.saida_em, s.id, s.numero, s.placa, v.codigo, c.nome,
               ${operador('s.operador_saida_id')}, s.valor_final_centavos, TIMESTAMPDIFF(MINUTE, s.entrada_em, s.saida_em)
          ${base} WHERE s.site_id = ? AND s.status = 'ENCERRADA' ORDER BY s.saida_em DESC LIMIT ?)
       UNION ALL
       (SELECT 'CANCELAMENTO', s.cancelado_em, s.id, s.numero, s.placa, v.codigo, c.nome,
               ${operador('s.cancelado_por')}, NULL, NULL
          ${base} WHERE s.site_id = ? AND s.status = 'CANCELADA' ORDER BY s.cancelado_em DESC LIMIT ?)
       ORDER BY em DESC LIMIT ?`,
      [siteId, limite, siteId, limite, siteId, limite, limite],
    );
    return linhas.map((l) => ({
      tipo: l.tipo,
      em: (l.em as Date).toISOString(),
      sessaoId: String(l.id),
      numero: String(l.numero),
      placa: String(l.placa),
      vaga: l.vaga ?? null,
      categoria: String(l.categoria),
      operador: l.operador ?? null,
      valorCentavos: l.valor === null ? null : n(l.valor),
      permanenciaMin: l.permanencia === null ? null : n(l.permanencia),
    }));
  },

  async sessoesAbertasParaCalculo(siteId: string): Promise<SessaoAbertaParaCalculo[]> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT s.entrada_em, s.modalidade,
              r.tolerancia_min, r.primeira_hora_centavos, r.hora_adicional_centavos, r.fracao_min, r.fracao_centavos,
              r.diaria_maxima_centavos, r.diaria_centavos,
              COALESCE((SELECT SUM(p.valor_centavos) FROM pagamentos p
                         WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO'), 0) AS pago
         FROM sessoes_estacionamento s
         JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
        WHERE s.site_id = ? AND s.status = 'ABERTA'`,
      [siteId],
    );
    const nulo = (v: unknown) => (v === null || v === undefined ? null : n(v));
    return linhas.map((l) => ({
      entradaEm: l.entrada_em as Date,
      modalidade: l.modalidade as Modalidade,
      pagoCentavos: n(l.pago),
      regra: {
        toleranciaMin: n(l.tolerancia_min),
        primeiraHoraCentavos: n(l.primeira_hora_centavos),
        horaAdicionalCentavos: n(l.hora_adicional_centavos),
        fracaoMin: nulo(l.fracao_min),
        fracaoCentavos: nulo(l.fracao_centavos),
        diariaMaximaCentavos: nulo(l.diaria_maxima_centavos),
        diariaCentavos: nulo(l.diaria_centavos),
      },
    }));
  },

  /** Pagamentos confirmados por dia local e forma, de N dias atrás até hoje. */
  async faturamentoPorDia(siteId: string, dias: number) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(${DIA_LOCAL('p.registrado_em')}, '%Y-%m-%d') AS dia, p.forma_codigo AS forma,
              SUM(p.valor_centavos) AS total, COUNT(*) AS qtd
         FROM pagamentos p
        WHERE p.site_id = ? AND p.status = 'CONFIRMADO'
          AND p.registrado_em >= ${INICIO_HOJE} - INTERVAL ? DAY
        GROUP BY dia, forma`,
      [siteId, dias - 1],
    );
    return linhas.map((l) => ({
      dia: String(l.dia),
      forma: String(l.forma),
      total: n(l.total),
      qtd: n(l.qtd),
    }));
  },

  async hojeLocal(): Promise<string> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT DATE_FORMAT(DATE(CONVERT_TZ(NOW(3), '+00:00', '${FUSO}')), '%Y-%m-%d') AS hoje`,
    );
    return String(l?.hoje);
  },

  async estornosHoje(siteId: string) {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS qtd, COALESCE(SUM(valor_centavos), 0) AS total
         FROM pagamentos WHERE site_id = ? AND status = 'ESTORNADO' AND estornado_em >= ${INICIO_HOJE}`,
      [siteId],
    );
    return { quantidade: n(l?.qtd), centavos: n(l?.total) };
  },

  async formasPagamento(): Promise<Map<string, string>> {
    const [linhas] = await pool.query<RowDataPacket[]>(
      'SELECT codigo, nome FROM formas_pagamento ORDER BY ordem',
    );
    return new Map(linhas.map((l) => [String(l.codigo), String(l.nome)]));
  },

  async caixasAbertos(siteId: string) {
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT c.id, c.aberto_em, p.nome AS posto, COALESCE(f.nome, u.login) AS operador,
              TIMESTAMPDIFF(MINUTE, c.aberto_em, NOW(3)) AS minutos
         FROM caixa_sessoes c
         JOIN postos p   ON p.id = c.posto_id
         JOIN usuarios u ON u.id = c.operador_id
         LEFT JOIN funcionarios f ON f.usuario_id = u.id
        WHERE c.site_id = ? AND c.status = 'ABERTO'
        ORDER BY c.aberto_em`,
      [siteId],
    );
    return linhas.map((l) => ({
      id: String(l.id),
      abertoEm: (l.aberto_em as Date).toISOString(),
      posto: String(l.posto),
      operador: String(l.operador),
      minutos: n(l.minutos),
    }));
  },

  async sincronizacao(siteId: string) {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT ultimo_sucesso_em, ultimo_erro_em, ultimo_erro, pendentes, rejeitados, pendente_mais_antigo,
              TIMESTAMPDIFF(MINUTE, pendente_mais_antigo, NOW(3)) AS minutos_atraso
         FROM vw_sync_status WHERE site_id = ?`,
      [siteId],
    );
    if (!l) {
      // Site sem linha em sync_estado: conta direto na outbox
      const [[o]] = await pool.query<RowDataPacket[]>(
        `SELECT SUM(status='PENDENTE') AS pendentes, SUM(status='REJEITADO') AS rejeitados, MIN(IF(status='PENDENTE', ocorrido_em, NULL)) AS antigo,
                TIMESTAMPDIFF(MINUTE, MIN(IF(status='PENDENTE', ocorrido_em, NULL)), NOW(3)) AS minutos_atraso
           FROM sync_outbox WHERE site_id = ?`,
        [siteId],
      );
      return {
        ultimoSucessoEm: null,
        ultimoErro: null,
        pendentes: n(o?.pendentes),
        rejeitados: n(o?.rejeitados),
        pendenteMaisAntigo: (o?.antigo as Date | null) ?? null,
        minutosAtraso: o?.minutos_atraso === null ? null : n(o?.minutos_atraso),
      };
    }
    return {
      ultimoSucessoEm: (l.ultimo_sucesso_em as Date | null) ?? null,
      ultimoErro: (l.ultimo_erro as string | null) ?? null,
      pendentes: n(l.pendentes),
      rejeitados: n(l.rejeitados),
      pendenteMaisAntigo: (l.pendente_mais_antigo as Date | null) ?? null,
      minutosAtraso: l.minutos_atraso === null ? null : n(l.minutos_atraso),
    };
  },

  /** Contagens para alertas operacionais. */
  async contagensParaAlertas(siteId: string) {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT
         (SELECT COUNT(*) FROM vagas WHERE site_id = ? AND situacao <> 'INATIVA') AS vagas,
         (SELECT COUNT(*) FROM tabelas_tarifa WHERE site_id = ? AND status = 'PUBLICADA' AND vigente_desde <= NOW(3)) AS tarifas_vigentes,
         (SELECT COUNT(*) FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ABERTA' AND entrada_em <= NOW(3) - INTERVAL 24 HOUR) AS sessoes_24h,
         (SELECT COUNT(*) FROM usuarios u JOIN usuario_perfis up ON up.usuario_id = u.id AND up.site_id = ?
           WHERE u.ativo = TRUE AND u.bloqueado_ate > NOW(3)) AS contas_bloqueadas`,
      [siteId, siteId, siteId, siteId],
    );
    return {
      vagas: n(l?.vagas),
      tarifasVigentes: n(l?.tarifas_vigentes),
      sessoesMais24h: n(l?.sessoes_24h),
      contasBloqueadas: n(l?.contas_bloqueadas),
    };
  },
};
