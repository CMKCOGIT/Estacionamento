import type { RowDataPacket } from 'mysql2/promise';
import { calcularEstadia } from '@estacionamento/calculo';
import {
  type Estadia,
  type EstatisticasVeiculo,
  type Modalidade,
  type VeiculoResumo,
} from '@estacionamento/shared';
import { COLUNAS_REGRA, regraDoTicket } from '../tarifas/regra.js';
import type { Conexao } from '../../db/pool.js';
import { pool } from '../../db/pool.js';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const flag = (v: unknown) => v !== null && v !== undefined && Number(v) !== 0;
const n = (v: unknown) => Number(v ?? 0);
const nulo = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Veículo + categoria + estadia aberta (se houver) com a regra de tarifa para estimar o valor. */
const SELECT_VEICULO = `
  SELECT v.id, v.placa, v.placa_estrangeira, v.categoria_id, c.nome AS categoria, v.marca, v.modelo, v.cor,
         v.observacoes, v.primeira_visita_em, v.ultima_visita_em, v.criado_em, v.atualizado_em,
         (SELECT COUNT(*) FROM sessoes_estacionamento x WHERE x.veiculo_id = v.id) AS total_estadias,
         a.id AS sessao_id, a.numero, a.entrada_em, a.modalidade, vg.codigo AS vaga,
         a.tarifa_aplicada, ${COLUNAS_REGRA},
         (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p WHERE p.sessao_id = a.id AND p.status = 'CONFIRMADO') AS pago
    FROM veiculos v
    JOIN categorias_veiculo c ON c.id = v.categoria_id
    LEFT JOIN sessoes_estacionamento a ON a.veiculo_aberto_id = v.id
    LEFT JOIN vagas vg ON vg.id = a.vaga_id
    LEFT JOIN tarifa_regras r ON r.id = a.tarifa_regra_id`;

function paraResumo(
  l: RowDataPacket,
  agora: Date,
): VeiculoResumo & {
  observacoes: string | null;
  criadoEm: string;
  atualizadoEm: string;
  primeiraVisitaEm: string | null;
} {
  let estadiaAtual: VeiculoResumo['estadiaAtual'] = null;
  if (l.sessao_id) {
    const estadia = calcularEstadia({
      entradaEm: l.entrada_em as Date,
      fim: agora,
      regra: regraDoTicket(l),
      modalidade: l.modalidade as Modalidade,
      pagoCentavos: n(l.pago),
    });
    estadiaAtual = {
      sessaoId: l.sessao_id,
      numero: String(l.numero),
      entradaEm: iso(l.entrada_em) ?? '',
      permanenciaMin: estadia.permanenciaMin,
      vaga: l.vaga ?? null,
      modalidade: l.modalidade,
      pagoCentavos: n(l.pago),
      valorEstimadoCentavos: estadia.aPagarCentavos,
    };
  }
  return {
    id: l.id,
    placa: l.placa,
    placaEstrangeira: flag(l.placa_estrangeira),
    categoriaId: l.categoria_id,
    categoria: l.categoria,
    marca: l.marca ?? null,
    modelo: l.modelo ?? null,
    cor: l.cor ?? null,
    totalEstadias: n(l.total_estadias),
    ultimaVisitaEm: iso(l.ultima_visita_em),
    estadiaAtual,
    observacoes: l.observacoes ?? null,
    criadoEm: iso(l.criado_em) ?? '',
    atualizadoEm: iso(l.atualizado_em) ?? '',
    primeiraVisitaEm: iso(l.primeira_visita_em),
  };
}

export interface FiltroVeiculos {
  busca?: string;
  categoriaId?: string;
  estacionados: boolean;
  pagina: number;
  limite: number;
}

export const veiculosRepository = {
  async agora(): Promise<Date> {
    const [[l]] = await pool.query<RowDataPacket[]>('SELECT NOW(3) AS agora');
    return l?.agora as Date;
  },

  async listar(siteId: string, f: FiltroVeiculos) {
    const where = ['v.site_id = ?'];
    const params: unknown[] = [siteId];
    if (f.categoriaId) {
      where.push('v.categoria_id = ?');
      params.push(f.categoriaId);
    }
    if (f.estacionados) where.push('a.id IS NOT NULL');
    if (f.busca) {
      const placa = f.busca.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const texto = `%${f.busca.replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
      where.push('(v.placa LIKE ? OR v.marca LIKE ? OR v.modelo LIKE ? OR v.cor LIKE ?)');
      params.push(`%${placa || '#'}%`, texto, texto, texto);
    }
    const base = `${SELECT_VEICULO} WHERE ${where.join(' AND ')}`;
    const [[total]] = await pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM (${base}) t`, params);
    const [linhas] = await pool.query<RowDataPacket[]>(
      `${base} ORDER BY (a.id IS NOT NULL) DESC, v.ultima_visita_em IS NULL, v.ultima_visita_em DESC, v.placa LIMIT ? OFFSET ?`,
      [...params, f.limite, (f.pagina - 1) * f.limite],
    );
    const [[est]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE site_id = ? AND status = 'ABERTA'",
      [siteId],
    );
    const agora = await this.agora();
    return {
      itens: linhas.map((l) => paraResumo(l, agora)),
      total: n(total?.n),
      estacionadosAgora: n(est?.n),
    };
  },

  async buscarPorId(siteId: string, id: string, c?: Conexao) {
    const [[l]] = await (c ?? pool).query<RowDataPacket[]>(
      `${SELECT_VEICULO} WHERE v.site_id = ? AND v.id = ?`,
      [siteId, id],
    );
    return l ? paraResumo(l, await this.agora()) : null;
  },

  async buscarPorPlaca(siteId: string, placa: string, c?: Conexao) {
    const [[l]] = await (c ?? pool).query<RowDataPacket[]>(
      `${SELECT_VEICULO} WHERE v.site_id = ? AND v.placa = ?`,
      [siteId, placa],
    );
    return l ? paraResumo(l, await this.agora()) : null;
  },

  async estatisticas(veiculoId: string): Promise<Omit<EstatisticasVeiculo, 'primeiraVisitaEm'>> {
    const [[l]] = await pool.query<RowDataPacket[]>(
      `SELECT COUNT(*) AS total,
              SUM(status = 'ENCERRADA') AS encerradas,
              SUM(status = 'CANCELADA') AS canceladas,
              SUM(IF(status = 'ENCERRADA', TIMESTAMPDIFF(MINUTE, entrada_em, saida_em), 0)) AS tempo_total,
              AVG(IF(status = 'ENCERRADA', TIMESTAMPDIFF(MINUTE, entrada_em, saida_em), NULL)) AS tempo_medio,
              (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p
                 JOIN sessoes_estacionamento s2 ON s2.id = p.sessao_id
                WHERE s2.veiculo_id = ? AND p.status = 'CONFIRMADO') AS total_pago
         FROM sessoes_estacionamento WHERE veiculo_id = ?`,
      [veiculoId, veiculoId],
    );
    return {
      totalEstadias: n(l?.total),
      encerradas: n(l?.encerradas),
      canceladas: n(l?.canceladas),
      tempoTotalMin: n(l?.tempo_total),
      tempoMedioMin:
        l?.tempo_medio === null || l?.tempo_medio === undefined ? null : Math.round(n(l.tempo_medio)),
      totalPagoCentavos: n(l?.total_pago),
    };
  },

  /** Histórico de estadias do veículo, da mais recente para a mais antiga. */
  async estadias(
    veiculoId: string,
    pagina: number,
    limite: number,
  ): Promise<{ itens: Estadia[]; temMais: boolean }> {
    const operador = (col: string) =>
      `(SELECT COALESCE(f.nome, u.login) FROM usuarios u LEFT JOIN funcionarios f ON f.usuario_id = u.id WHERE u.id = ${col})`;
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT s.id, s.numero, s.placa, s.status, s.modalidade, c.nome AS categoria, vg.codigo AS vaga,
              s.entrada_em, s.saida_em, s.cancelado_em, s.valor_final_centavos, s.motivo_cancelamento,
              TIMESTAMPDIFF(MINUTE, s.entrada_em, COALESCE(s.saida_em, s.cancelado_em, NOW(3))) AS permanencia,
              (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO') AS pago,
              ${operador('s.operador_entrada_id')} AS operador_entrada,
              ${operador('s.operador_saida_id')} AS operador_saida
         FROM sessoes_estacionamento s
         JOIN categorias_veiculo c ON c.id = s.categoria_id
         LEFT JOIN vagas vg ON vg.id = s.vaga_id
        WHERE s.veiculo_id = ?
        ORDER BY s.entrada_em DESC, s.id DESC
        LIMIT ? OFFSET ?`,
      [veiculoId, limite + 1, (pagina - 1) * limite],
    );
    return {
      temMais: linhas.length > limite,
      itens: linhas.slice(0, limite).map((l) => ({
        sessaoId: l.id,
        numero: String(l.numero),
        placa: l.placa,
        status: l.status,
        modalidade: l.modalidade,
        categoria: l.categoria,
        vaga: l.vaga ?? null,
        entradaEm: iso(l.entrada_em) ?? '',
        saidaEm: iso(l.saida_em),
        permanenciaMin: Math.max(0, n(l.permanencia)),
        valorFinalCentavos: nulo(l.valor_final_centavos),
        pagoCentavos: n(l.pago),
        operadorEntrada: l.operador_entrada ?? null,
        operadorSaida: l.operador_saida ?? null,
        motivoCancelamento: l.motivo_cancelamento ?? null,
      })),
    };
  },
};
