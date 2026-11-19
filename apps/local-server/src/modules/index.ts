import type { Router } from 'express';
import { formasPagamentoRouter } from './formas-pagamento/formas-pagamento.routes.js';
import { healthRouter } from './health/health.routes.js';

export interface ModuloApi {
  /** Caminho relativo a /api/v1 */
  caminho: string;
  router: Router;
}

/**
 * Registro de módulos da API. Para criar um módulo novo:
 *   1. crie a pasta em src/modules/<nome> com routes, service e repository;
 *   2. adicione-o nesta lista.
 *
 * Próximos módulos previstos (docs/ARQUITETURA.md §5):
 *   auth, usuarios, funcionarios, vagas, veiculos, clientes, sessoes,
 *   tarifas, pagamentos, caixa, relatorios, sync.
 */
export const modulos: ModuloApi[] = [
  { caminho: '/health', router: healthRouter },
  { caminho: '/formas-pagamento', router: formasPagamentoRouter },
];
