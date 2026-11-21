import { mascararDadosPessoais } from '@estacionamento/shared';
import { logger } from '../config/logger.js';
import { pool } from '../db/pool.js';

/**
 * Guarda erros internos para o painel de monitoramento (sem dados pessoais).
 * Nunca lança: registrar um erro não pode causar outro erro.
 */
export function registrarErroSistema(e: {
  origem: 'API' | 'PROCESSO';
  codigo?: string | null;
  mensagem: string;
  metodo?: string | null;
  rota?: string | null;
  requisicaoId?: string | null;
}): void {
  pool
    .query(
      'INSERT INTO erros_sistema (origem, codigo, mensagem, metodo, rota, requisicao_id) VALUES (?, ?, ?, ?, ?, ?)',
      [
        e.origem,
        e.codigo?.slice(0, 40) ?? null,
        mascararDadosPessoais(e.mensagem).slice(0, 1000),
        e.metodo ?? null,
        e.rota ? e.rota.split('?')[0]!.slice(0, 200) : null,
        e.requisicaoId?.slice(0, 64) ?? null,
      ],
    )
    .catch((x: unknown) => logger.debug({ err: x }, 'Não foi possível registrar o erro no monitoramento'));
}
