/**
 * Contrato da SINCRONIZAÇÃO servidor local → API externa (`/sync/v1`).
 *
 * Cada evento carrega a PROJEÇÃO PÚBLICA do que mudou (o estado atual do
 * ticket, das vagas, da tabela de tarifas ou do estacionamento), só com o que
 * o cliente pode ver. Pagamentos individuais, caixa, operadores e usuários
 * nunca saem do servidor local (ARQUITETURA §6.1).
 *
 * Aplicação na nuvem: idempotente pelo `eventId` e, para cada item, só se o
 * `seq` for maior que o último aplicado (um evento atrasado nunca desfaz um
 * mais novo).
 */
import type { ItemCalculo, Modalidade, RegraTarifa } from './tarifa.js';

export const VERSAO_EVENTOS_SYNC = 2;

export interface ProjecaoSite {
  slug: string;
  nome: string;
  endereco: string | null;
  telefone: string | null;
  /** Política de encerramento do link do cliente. */
  horasAcessoAposSaida: number;
  /** Contato do encarregado de dados (LGPD art. 41), mostrado no app do cliente. */
  contatoPrivacidade?: string | null;
}

export interface ProjecaoDisponibilidade {
  categorias: { id: string; nome: string; ordem: number; total: number; livres: number }[];
}

export interface ProjecaoTarifa {
  /** Id da regra no servidor local. */
  id: string;
  categoria: string;
  ordem: number;
  nome: string;
  especial: boolean;
  condicao: string | null;
  linhas: string[];
}

export interface ProjecaoTabelaTarifa {
  tabelaId: string;
  versao: number;
  vigenteDesde: string;
  tarifas: ProjecaoTarifa[];
}

export interface ProjecaoTokenTicket {
  /** SHA-256 do token do link, em hexadecimal (o token nunca é enviado). */
  hash: string;
  revogadoEm: string | null;
}

export interface ProjecaoTicket {
  id: string;
  numero: number;
  placa: string;
  categoria: string;
  vaga: string | null;
  modalidade: Modalidade;
  situacao: 'ESTACIONADO' | 'ENCERRADO' | 'CANCELADO';
  entradaEm: string;
  saidaEm: string | null;
  /** Tarifa gravada no ticket na entrada (o valor acumulado é calculado com ela). */
  regra: Required<RegraTarifa>;
  tarifaNome: string;
  tarifaDescricao: string;
  valorFinalCentavos: number | null;
  itensFinal: ItemCalculo[] | null;
  /** Só o total pago (nunca formas de pagamento, operador ou caixa). */
  pagoCentavos: number;
  acessoExpiraEm: string | null;
  tokens: ProjecaoTokenTicket[];
}

export type DadosEventoSync =
  | { tipo: 'site'; site: ProjecaoSite }
  | { tipo: 'disponibilidade'; disponibilidade: ProjecaoDisponibilidade }
  | { tipo: 'tabela_tarifa'; tabela: ProjecaoTabelaTarifa }
  | { tipo: 'tabela_tarifa_arquivada'; tabelaId: string }
  | { tipo: 'ticket'; ticket: ProjecaoTicket }
  /** O ticket não existe mais no servidor local (ex.: banco restaurado de backup): a nuvem apaga. */
  | { tipo: 'ticket_removido'; ticketId: string };

export interface EventoSync {
  eventId: string;
  seq: number;
  /** Ex.: "ticket.aberto", "ticket.fechado", "vagas.disponibilidade". */
  tipo: string;
  versao: number;
  ocorridoEm: string;
  agregado: { tipo: string; id: string };
  dados: DadosEventoSync;
}

/** POST /sync/v1/push — até 100 eventos, em ordem de `seq`. Vazio = sinal de vida. */
export interface LoteSync {
  /** Estacionamento que envia (tem de ser o da credencial). */
  siteId: string;
  eventos: EventoSync[];
}

export interface RespostaPushSync {
  aplicados: number;
  /** Já recebidos antes (mesmo `eventId`): confirmados sem aplicar de novo. */
  repetidos: number;
  /** Mais antigos que o estado já aplicado para o mesmo item. */
  superados: number;
  /** Inválidos: o servidor local os separa (dead-letter) e avisa no painel. */
  rejeitados: { eventId: string; motivo: string }[];
  /** Resultado de cada evento (registrado no servidor local, evento a evento). */
  resultados?: { eventId: string; resultado: ResultadoEventoSync }[];
  ultimoSeq: number;
  recebidoEm: string;
}

export type ResultadoEventoSync = 'APLICADO' | 'REPETIDO' | 'SUPERADO' | 'REJEITADO';

/**
 * POST /sync/v1/conferir — conferência entre os bancos. O servidor local
 * manda a "impressão digital" (hash) do estado atual de cada item visível; a
 * nuvem compara com o que tem e devolve o que está diferente, faltando ou
 * sobrando. O servidor local, fonte da verdade, então reenvia ou remove.
 */
export type TipoItemConferencia = 'site' | 'disponibilidade' | 'tabela_tarifa' | 'ticket';
export interface PedidoConferenciaSync {
  siteId: string;
  itens: { tipo: TipoItemConferencia; id: string; hash: string }[];
}
export interface RespostaConferenciaSync {
  /** Na nuvem com conteúdo diferente, ou ausentes. */
  divergentes: { tipo: TipoItemConferencia; id: string; motivo: 'DIFERENTE' | 'AUSENTE' }[];
  /** Na nuvem (visíveis ao cliente), mas não na lista do servidor local. */
  sobrando: { tipo: TipoItemConferencia; id: string }[];
  conferidos: number;
}

/**
 * JSON canônico (chaves em ordem alfabética, sem espaços): o mesmo objeto gera
 * sempre o mesmo texto, nos dois lados. Base do hash da conferência.
 */
export function jsonCanonico(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonCanonico(o[k])}`)
    .join(',')}}`;
}

/**
 * Forma canônica de um item para a conferência: as listas sem ordem própria
 * (tokens, categorias, tarifas) são ordenadas, para que o servidor local
 * (que lê do banco dele) e a nuvem (que remonta do banco dela) cheguem ao
 * mesmo texto quando o conteúdo é o mesmo.
 */
export function formaDeConferencia(tipo: TipoItemConferencia, dados: unknown): string {
  const d = structuredClone(dados) as Record<string, unknown>;
  const porId = (a: unknown) =>
    Array.isArray(a) ? [...a].sort((x, y) => String(x.id).localeCompare(String(y.id))) : a;
  if (tipo === 'ticket' && Array.isArray(d.tokens))
    d.tokens = [...d.tokens].sort((x, y) => String(x.hash).localeCompare(String(y.hash)));
  if (tipo === 'disponibilidade') d.categorias = porId(d.categorias);
  if (tipo === 'tabela_tarifa') d.tarifas = porId(d.tarifas);
  return jsonCanonico(d);
}

/** POST /sync/v1/snapshot — ressincronização completa, em partes. */
export interface ParteSnapshotSync {
  siteId: string;
  snapshotId: string;
  parte: number;
  totalPartes: number;
  /** Estado no momento da carga (seq do último evento incluído). */
  seq: number;
  site?: ProjecaoSite;
  disponibilidade?: ProjecaoDisponibilidade;
  tabelas?: ProjecaoTabelaTarifa[];
  tickets?: ProjecaoTicket[];
}

export interface RespostaSnapshotSync {
  snapshotId: string;
  parte: number;
  concluido: boolean;
  /** Ao concluir: tickets que estavam na nuvem e não vieram na carga (removidos). */
  removidos: number;
}

export interface StatusSync {
  siteId: string | null;
  ultimoSeq: number;
  ultimoContatoEm: string | null;
  ultimoSnapshotEm: string | null;
}

/** Cabeçalhos da autenticação das integrações (ARQUITETURA §7.2). */
export const CABECALHOS_INTEGRACAO = {
  id: 'x-integracao-id',
  timestamp: 'x-timestamp',
  nonce: 'x-nonce',
  assinatura: 'x-assinatura',
} as const;

/**
 * Texto assinado com HMAC-SHA256(segredo):
 * `v1\n<timestamp>\n<nonce>\n<MÉTODO>\n<rota>\n<sha256 hex do corpo>`.
 * A assinatura vai em `X-Assinatura: v1=<hex>`.
 */
export function textoParaAssinar(p: {
  timestamp: string;
  nonce: string;
  metodo: string;
  rota: string;
  sha256Corpo: string;
}): string {
  return ['v1', p.timestamp, p.nonce, p.metodo.toUpperCase(), p.rota, p.sha256Corpo].join('\n');
}

/** Tolerância de relógio entre o servidor local e a nuvem (contra replay). */
export const JANELA_ASSINATURA_SEGUNDOS = 300;
