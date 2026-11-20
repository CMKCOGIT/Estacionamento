/**
 * Regras da atualização do ticket no app (puras, testadas em tests/pwa.test.ts).
 *
 * Princípio: o app só chama de "agora" o que a API acabou de calcular.
 * Qualquer dado que não veio de uma consulta recente bem-sucedida aparece
 * como "dados de HH:MM", nunca como tempo real.
 */
import type { TicketPublico } from '@estacionamento/shared';
import type { FalhaApi } from '../api';

/** Estacionado: consulta a API a cada 30 s (e no minuto exato em que o valor sobe). */
export const INTERVALO_ATIVO_MS = 30_000;
/** Depois disso sem resposta nova, os dados são "desatualizados" (2 consultas perdidas + folga). */
export const LIMITE_AO_VIVO_MS = 75_000;
/** O estacionamento (servidor local) sem enviar dados à nuvem há mais que isso: aviso. */
export const LIMITE_SINCRONIA_MS = 3 * 60_000;
/** Espera entre tentativas depois de falhas seguidas: 5 s, 10 s, 20 s, 40 s, 60 s, 60 s... */
const ESPERAS_FALHA_MS = [5_000, 10_000, 20_000, 40_000, 60_000];

export interface EntradaAgenda {
  situacao: TicketPublico['situacao'] | null;
  proximaCobrancaEm: string | null;
  /** Diferença relógio do servidor − relógio do celular (ms). */
  desvioRelogioMs: number;
  falhasSeguidas: number;
  ultimaFalha: FalhaApi | null;
  agora: number;
}

/**
 * Daqui a quantos ms consultar de novo; `null` = não precisa (ticket encerrado
 * ou cancelado já não muda, e link encerrado não volta).
 */
export function proximaConsultaEm(e: EntradaAgenda): number | null {
  if (e.ultimaFalha === 'NAO_ENCONTRADO') return null;
  if (e.falhasSeguidas > 0) {
    if (e.ultimaFalha === 'MUITAS_TENTATIVAS') return 60_000;
    return ESPERAS_FALHA_MS[Math.min(e.falhasSeguidas - 1, ESPERAS_FALHA_MS.length - 1)]!;
  }
  if (e.situacao === null) return 5_000;
  if (e.situacao !== 'ESTACIONADO') return null;
  let espera = INTERVALO_ATIVO_MS;
  if (e.proximaCobrancaEm) {
    // momento da próxima cobrança no relógio do celular, +1 s de folga
    const ate = Date.parse(e.proximaCobrancaEm) - e.desvioRelogioMs - e.agora + 1_000;
    if (ate > 0) espera = Math.min(espera, Math.max(ate, 2_000));
  }
  return espera;
}

export type Frescor =
  /** Consulta recente e o estacionamento enviando dados normalmente. */
  | 'AO_VIVO'
  /** Consulta recente, mas o estacionamento parou de enviar dados à nuvem. */
  | 'SEM_SINCRONIA'
  /** A última consulta bem-sucedida é antiga (falha, sem internet ou app parado). */
  | 'DESATUALIZADO';

export interface EntradaFrescor {
  /** Relógio do celular no momento em que a última resposta chegou. */
  recebidoEm: number | null;
  /** A última tentativa falhou? */
  falhando: boolean;
  /** Horário do cálculo e do último envio do estacionamento (relógio do servidor). */
  calculadoEm: string;
  sincronizadoEm: string | null;
  agora: number;
}

export function avaliarFrescor(e: EntradaFrescor): Frescor {
  if (e.recebidoEm === null || e.falhando || e.agora - e.recebidoEm > LIMITE_AO_VIVO_MS)
    return 'DESATUALIZADO';
  if (e.sincronizadoEm && Date.parse(e.calculadoEm) - Date.parse(e.sincronizadoEm) > LIMITE_SINCRONIA_MS)
    return 'SEM_SINCRONIA';
  return 'AO_VIVO';
}

/** Mensagem de indisponibilidade para cada falha (o que houve + o que o app está fazendo). */
export function mensagemDeFalha(f: FalhaApi): string {
  switch (f) {
    case 'SEM_CONEXAO':
      return 'Sem internet no celular.';
    case 'TEMPO_ESGOTADO':
      return 'O serviço do estacionamento está lento e não respondeu a tempo.';
    case 'MUITAS_TENTATIVAS':
      return 'Muitas consultas seguidas. Aguarde um pouco.';
    case 'NAO_ENCONTRADO':
      return 'Este link não funciona mais.';
    default:
      return 'O serviço do estacionamento está indisponível no momento.';
  }
}
