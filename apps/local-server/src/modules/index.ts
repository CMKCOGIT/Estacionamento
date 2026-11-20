import type { Router } from 'express';
import { atividadesRouter } from './atividades/atividades.routes.js';
import { authRouter } from './auth/auth.routes.js';
import { dashboardRouter } from './dashboard/dashboard.routes.js';
import { financeiroRouter } from './financeiro/financeiro.routes.js';
import { formasPagamentoRouter } from './formas-pagamento/formas-pagamento.routes.js';
import { healthRouter } from './health/health.routes.js';
import { caixaRouter, sessoesRouter } from './sessoes/sessoes.routes.js';
import { tarifasRouter } from './tarifas/tarifas.routes.js';
import { permissoesRouter } from './usuarios/permissoes.routes.js';
import { usuariosRouter } from './usuarios/usuarios.routes.js';
import { categoriasRouter, vagasRouter } from './vagas/vagas.routes.js';
import { veiculosRouter } from './veiculos/veiculos.routes.js';

export interface ModuloApi {
  /** Caminho relativo a /api/v1 */
  caminho: string;
  router: Router;
  /**
   * true = o módulo cuida da própria autenticação (rotas públicas).
   * Padrão (false): TODAS as rotas exigem login e troca de senha em dia.
   */
  publico?: boolean;
}

/**
 * Registro de módulos da API. Para criar um módulo novo:
 *   1. crie a pasta em src/modules/<nome> com routes, service e repository;
 *   2. adicione-o nesta lista (protegido por padrão);
 *   3. nas rotas, use exigirPermissao('<modulo>.<acao>') para cada nível de acesso.
 *
 * Próximos módulos previstos (docs/ARQUITETURA.md §5):
 *   clientes,
 *   tarifas, pagamentos, caixa, relatorios, sync.
 */
export const modulos: ModuloApi[] = [
  { caminho: '/health', router: healthRouter, publico: true },
  { caminho: '/auth', router: authRouter, publico: true },
  { caminho: '/dashboard', router: dashboardRouter },
  { caminho: '/formas-pagamento', router: formasPagamentoRouter },
  { caminho: '/vagas', router: vagasRouter },
  { caminho: '/categorias', router: categoriasRouter },
  { caminho: '/veiculos', router: veiculosRouter },
  { caminho: '/sessoes', router: sessoesRouter },
  { caminho: '/caixa', router: caixaRouter },
  { caminho: '/tarifas', router: tarifasRouter },
  { caminho: '/financeiro', router: financeiroRouter },
  { caminho: '/usuarios', router: usuariosRouter },
  { caminho: '/permissoes', router: permissoesRouter },
  { caminho: '/atividades', router: atividadesRouter },
];
