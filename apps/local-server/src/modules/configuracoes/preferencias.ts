import type { RowDataPacket } from 'mysql2';
import {
  CONFIG_PADRAO,
  type ConfiguracaoBackup,
  type ConfiguracaoSeguranca,
  type DadosEstacionamento,
  type LimitesAjuste,
  type PreferenciasNotificacao,
  type PreferenciasOperacao,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';

/**
 * Configurações por categoria, guardadas na tabela `configuracoes` (uma chave
 * por categoria, valor JSON). Sem nada salvo, valem os padrões — e, para
 * segurança e backup, os valores do .env (quem já tinha ajustado o .env não
 * perde nada com a atualização).
 *
 * As leituras ficam 30 s em memória: segurança e limites são consultados a
 * cada requisição. Salvar pelo painel limpa o cache na hora.
 */
export interface MapaConfig {
  estacionamento: Omit<DadosEstacionamento, 'logo'>;
  logo: { dataUrl: string | null };
  operacao: PreferenciasOperacao;
  seguranca: ConfiguracaoSeguranca;
  limitesAjuste: LimitesAjuste;
  notificacoes: PreferenciasNotificacao;
  backup: ConfiguracaoBackup;
}
export type ChaveConfig = keyof MapaConfig;

/** Nome da chave na tabela (a de backup fica separada da política de retenção). */
export const CHAVE_TABELA: Record<ChaveConfig, string> = {
  estacionamento: 'estacionamento',
  logo: 'logo',
  operacao: 'operacao',
  seguranca: 'seguranca',
  limitesAjuste: 'limites_ajuste',
  notificacoes: 'notificacoes',
  backup: 'backup_agenda',
};

export function padroes(): MapaConfig {
  const { logo: _logo, ...estacionamento } = CONFIG_PADRAO.estacionamento;
  return {
    estacionamento,
    logo: { dataUrl: null },
    operacao: { ...CONFIG_PADRAO.operacao },
    seguranca: {
      ...CONFIG_PADRAO.seguranca,
      inatividadeMin: env.SESSAO_INATIVIDADE_MIN,
      duracaoMaxHoras: env.SESSAO_DURACAO_MAX_HORAS,
      maxTentativas: env.LOGIN_MAX_TENTATIVAS,
      bloqueioMin: env.LOGIN_BLOQUEIO_MIN,
    },
    limitesAjuste: {
      gerente: { ...CONFIG_PADRAO.limitesAjuste.gerente },
      funcionario: { ...CONFIG_PADRAO.limitesAjuste.funcionario },
    },
    notificacoes: { ...CONFIG_PADRAO.notificacoes },
    backup: { ativo: env.BACKUP_ATIVO, horario: env.BACKUP_HORA },
  };
}

const VALIDADE_MS = 30_000;
let cache: { valor: MapaConfig; em: number } | null = null;

const json = (v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as unknown) : v);

/** Junta o salvo com o padrão (campo novo ou ausente → padrão). */
function mesclar<T extends object>(padrao: T, salvo: unknown): T {
  if (!salvo || typeof salvo !== 'object') return padrao;
  const r: Record<string, unknown> = { ...(padrao as Record<string, unknown>) };
  for (const [k, v] of Object.entries(padrao as Record<string, unknown>)) {
    const s = (salvo as Record<string, unknown>)[k];
    if (s === undefined) continue;
    r[k] = v && typeof v === 'object' && !Array.isArray(v) ? mesclar(v as object, s) : s;
  }
  return r as T;
}

export async function carregarConfig(forcar = false): Promise<MapaConfig> {
  if (!forcar && cache && Date.now() - cache.em < VALIDADE_MS) return cache.valor;
  const site = await obterSiteAtual();
  const [linhas] = await pool.query<RowDataPacket[]>(
    'SELECT chave, valor FROM configuracoes WHERE site_id = ? AND chave IN (?)',
    [site.id, Object.values(CHAVE_TABELA)],
  );
  const salvos = new Map(linhas.map((l) => [String(l.chave), json(l.valor)]));
  const base = padroes();
  const valor = Object.fromEntries(
    (Object.keys(CHAVE_TABELA) as ChaveConfig[]).map((k) => [
      k,
      mesclar(base[k], salvos.get(CHAVE_TABELA[k])),
    ]),
  ) as unknown as MapaConfig;
  cache = { valor, em: Date.now() };
  return valor;
}

/** Último valor lido (para uso síncrono, ex.: duração do cookie). */
export function configEmCache(): MapaConfig {
  return cache?.valor ?? padroes();
}

export function limparCacheConfig(): void {
  cache = null;
}
