import type { RowDataPacket } from 'mysql2/promise';
import {
  descreverCondicao,
  descreverRegra,
  linhasPublicasDaRegra,
  POLITICA_ACESSO_PADRAO,
  type ItemCalculo,
  type ProjecaoDisponibilidade,
  type ProjecaoSite,
  type ProjecaoTabelaTarifa,
  type ProjecaoTicket,
  type TarifaAplicada,
} from '@estacionamento/shared';
import type { Conexao } from '../db/pool.js';
import type { pool } from '../db/pool.js';
import { lerJson, regraDaLinha, regraDoTicket, COLUNAS_REGRA } from '../modules/tarifas/regra.js';

/**
 * PROJEÇÕES PÚBLICAS: o que a nuvem (e o app do cliente) pode saber de cada
 * coisa. É a única porta de saída de dados do servidor local para a internet
 * (docs/API-EXTERNA.md, "Dados públicos"). Nada de pagamentos individuais,
 * formas de pagamento, operadores, caixa, usuários ou cadastro de clientes.
 */
type Leitor = Conexao | typeof pool;
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : null);
const hhmm = (v: unknown) => (v ? String(v).slice(0, 5) : null);

export async function projecaoSite(c: Leitor, siteId: string): Promise<ProjecaoSite> {
  const [[s]] = await c.query<RowDataPacket[]>(
    `SELECT s.slug, s.nome, s.endereco, s.telefone, cfg.valor AS politica, enc.valor AS encarregado
       FROM sites s
       LEFT JOIN configuracoes cfg ON cfg.site_id = s.id AND cfg.chave = 'acesso_cliente'
       LEFT JOIN configuracoes enc ON enc.site_id = s.id AND enc.chave = 'encarregado_dados'
      WHERE s.id = ?`,
    [siteId],
  );
  if (!s) throw new Error(`Estacionamento ${siteId} não encontrado`);
  const horas = lerJson<{ horasAposSaida?: number }>(s.politica)?.horasAposSaida;
  const enc = lerJson<{ nome?: string | null; contato?: string | null }>(s.encarregado);
  const contato = [enc?.nome, enc?.contato].filter(Boolean).join(' — ') || null;
  return {
    slug: String(s.slug),
    nome: String(s.nome),
    endereco: (s.endereco as string | null) ?? null,
    telefone: (s.telefone as string | null) ?? null,
    horasAcessoAposSaida: Number.isInteger(horas) ? Number(horas) : POLITICA_ACESSO_PADRAO.horasAposSaida,
    contatoPrivacidade: contato ? contato.slice(0, 200) : null,
  };
}

/** Vagas por categoria: total = em uso (livres + ocupadas + em manutenção); livres = ativas sem veículo. */
export async function projecaoDisponibilidade(c: Leitor, siteId: string): Promise<ProjecaoDisponibilidade> {
  const [linhas] = await c.query<RowDataPacket[]>(
    `SELECT c.id, c.nome, c.ordem,
            COALESCE(SUM(v.situacao IN ('ATIVA', 'MANUTENCAO')), 0) AS total,
            COALESCE(SUM(v.situacao = 'ATIVA' AND NOT EXISTS
              (SELECT 1 FROM sessoes_estacionamento x WHERE x.vaga_ocupada_id = v.id)), 0) AS livres
       FROM categorias_veiculo c JOIN vagas v ON v.categoria_id = c.id
      WHERE c.site_id = ? AND c.ativo
      GROUP BY c.id, c.nome, c.ordem
      ORDER BY c.ordem, c.nome`,
    [siteId],
  );
  return {
    categorias: linhas.map((l) => ({
      id: String(l.id),
      nome: String(l.nome),
      ordem: Number(l.ordem),
      total: Number(l.total),
      livres: Number(l.livres),
    })),
  };
}

/** Tabela de preços publicada, em textos prontos para o cliente. */
export async function projecaoTabelaTarifa(c: Leitor, tabelaId: string): Promise<ProjecaoTabelaTarifa> {
  const [regras] = await c.query<RowDataPacket[]>(
    `SELECT r.*, c.nome AS categoria, c.ordem AS cat_ordem, t.vigente_desde, t.versao AS tabela_versao
       FROM tabelas_tarifa t
       JOIN tarifa_regras r ON r.tabela_id = t.id AND r.ativo
       JOIN categorias_veiculo c ON c.id = r.categoria_id
      WHERE t.id = ?
      ORDER BY c.ordem, r.tipo, r.ordem`,
    [tabelaId],
  );
  const [[t]] = await c.query<RowDataPacket[]>(
    'SELECT versao, vigente_desde FROM tabelas_tarifa WHERE id = ?',
    [tabelaId],
  );
  if (!t?.vigente_desde) throw new Error(`Tabela de tarifas ${tabelaId} não publicada`);
  return {
    tabelaId,
    versao: Number(t.versao),
    vigenteDesde: (t.vigente_desde as Date).toISOString(),
    tarifas: regras.map((r) => {
      const especial = r.tipo === 'ESPECIAL';
      return {
        id: String(r.id),
        categoria: String(r.categoria),
        ordem: Number(r.cat_ordem) * 100 + Number(r.ordem ?? 0) + (especial ? 50 : 0),
        nome: especial ? String(r.nome) : 'Padrão',
        especial,
        condicao: !especial
          ? null
          : r.aplicacao === 'MANUAL'
            ? 'Informe no caixa (convênio ou evento)'
            : descreverCondicao({
                diasSemana: n(r.dias_semana),
                horaInicio: hhmm(r.hora_inicio),
                horaFim: hhmm(r.hora_fim),
              }),
        linhas: linhasPublicasDaRegra(regraDaLinha(r)),
      };
    }),
  };
}

/** Tabelas que o cliente pode ver: a em vigor e as já publicadas para começar depois. */
export async function tabelasPublicadasVisiveis(c: Leitor, siteId: string): Promise<string[]> {
  const [l] = await c.query<RowDataPacket[]>(
    `SELECT t.id FROM tabelas_tarifa t
      WHERE t.site_id = ? AND t.status = 'PUBLICADA'
        AND (t.vigente_desde > NOW(3) OR t.id = (
          SELECT v.id FROM tabelas_tarifa v WHERE v.site_id = t.site_id AND v.status = 'PUBLICADA' AND v.vigente_desde <= NOW(3)
           ORDER BY v.vigente_desde DESC, v.versao DESC LIMIT 1))`,
    [siteId],
  );
  return l.map((x) => String(x.id));
}

/** O ticket como o cliente o vê: o valor acumulado é calculado na nuvem com a `regra` gravada. */
export async function projecaoTicket(c: Leitor, sessaoId: string): Promise<ProjecaoTicket> {
  const [[s]] = await c.query<RowDataPacket[]>(
    `SELECT s.id, s.numero, s.placa, s.modalidade, s.status, s.entrada_em, s.saida_em, s.cancelado_em,
            s.valor_final_centavos, s.tarifa_aplicada, s.calculo_detalhe, c.nome AS categoria, v.codigo AS vaga,
            ${COLUNAS_REGRA}, r.tipo AS regra_tipo, r.nome AS regra_nome,
            (SELECT COALESCE(SUM(p.valor_centavos), 0) FROM pagamentos p
              WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO') AS pago
       FROM sessoes_estacionamento s
       JOIN categorias_veiculo c ON c.id = s.categoria_id
       JOIN tarifa_regras r ON r.id = s.tarifa_regra_id
       LEFT JOIN vagas v ON v.id = s.vaga_id
      WHERE s.id = ?`,
    [sessaoId],
  );
  if (!s) throw new Error(`Ticket ${sessaoId} não encontrado`);
  const [tokens] = await c.query<RowDataPacket[]>(
    'SELECT token_hash, revogado_em, expira_em FROM sessao_tokens WHERE sessao_id = ? ORDER BY criado_em',
    [sessaoId],
  );
  const aplicada = lerJson<TarifaAplicada>(s.tarifa_aplicada);
  const regra = regraDoTicket(s);
  const situacao =
    s.status === 'ABERTA' ? 'ESTACIONADO' : s.status === 'ENCERRADA' ? 'ENCERRADO' : 'CANCELADO';
  // Prazo do link: definido na saída (política). Cancelado: termina no cancelamento.
  const expira =
    situacao === 'ESTACIONADO'
      ? null
      : situacao === 'CANCELADO'
        ? (s.cancelado_em as Date)
        : (tokens
            .map((k) => k.expira_em as Date | null)
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? (s.saida_em as Date));
  const nome =
    aplicada?.nome ?? (s.regra_tipo === 'ESPECIAL' ? String(s.regra_nome ?? 'Especial') : 'Padrão');
  return {
    id: String(s.id),
    numero: Number(s.numero),
    placa: String(s.placa),
    categoria: String(s.categoria),
    vaga: (s.vaga as string | null) ?? null,
    modalidade: s.modalidade,
    situacao,
    entradaEm: (s.entrada_em as Date).toISOString(),
    saidaEm: iso(s.saida_em),
    regra,
    tarifaNome: nome.slice(0, 80),
    tarifaDescricao: descreverRegra(regra, s.modalidade).slice(0, 255),
    valorFinalCentavos: situacao === 'ENCERRADO' ? Number(s.valor_final_centavos) : null,
    itensFinal:
      situacao === 'ENCERRADO' ? (lerJson<{ itens: ItemCalculo[] }>(s.calculo_detalhe)?.itens ?? []) : null,
    pagoCentavos: Number(s.pago),
    acessoExpiraEm: iso(expira),
    tokens: tokens.map((k) => ({
      hash: (k.token_hash as Buffer).toString('hex'),
      revogadoEm: iso(k.revogado_em),
    })),
  };
}

/** Tickets que a nuvem precisa ter numa carga completa: abertos e os com link ainda válido. */
export async function ticketsVisiveis(c: Leitor, siteId: string): Promise<string[]> {
  const [l] = await c.query<RowDataPacket[]>(
    `SELECT s.id FROM sessoes_estacionamento s
      WHERE s.site_id = ? AND (s.status = 'ABERTA' OR EXISTS (
        SELECT 1 FROM sessao_tokens k WHERE k.sessao_id = s.id AND k.revogado_em IS NULL AND k.expira_em > NOW(3)))
      ORDER BY s.entrada_em`,
    [siteId],
  );
  return l.map((x) => String(x.id));
}
