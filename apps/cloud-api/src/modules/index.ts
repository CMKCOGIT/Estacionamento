import type { Router } from 'express';
import { publicoRouter } from './publico/publico.routes.js';
import { syncRouter } from './sync/sync.routes.js';

/**
 * Módulos da API externa. Cada um declara QUEM pode usá-lo:
 *  - PUBLICO: clientes pelo PWA. Somente leitura (GET), CORS só para o PWA,
 *    dados limitados ao que é público (docs/API-EXTERNA.md).
 *  - INTEGRACAO: sistemas autenticados por HMAC (servidor local; futuramente
 *    parceiros), com escopos por rota. Sem CORS: nunca pelo navegador.
 *
 * Para uma integração futura (ex.: app de parceiro, Pix online, mensalistas):
 * crie src/modules/<nome>, use autenticarIntegracao('<escopo>') nas rotas,
 * acrescente o escopo em integracoes/credenciais.ts e registre aqui com um
 * caminho versionado (ex.: /parceiros/v1). Documente em openapi.yaml.
 */
export interface ModuloApi {
  caminho: string;
  router: Router;
  acesso: 'PUBLICO' | 'INTEGRACAO';
  descricao: string;
}

export const modulos: ModuloApi[] = [
  { caminho: '/v1', router: publicoRouter, acesso: 'PUBLICO', descricao: 'Consulta do cliente (PWA)' },
  {
    caminho: '/sync/v1',
    router: syncRouter,
    acesso: 'INTEGRACAO',
    descricao: 'Sincronização do servidor local',
  },
];
