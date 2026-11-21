import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Test } from 'supertest';
import { criarApp } from '../../src/app.js';
import { fecharPool } from '../../src/db/pool.js';
import { modulos } from '../../src/modules/index.js';
import { criarUsuario, entrar, garantirAdmin } from './ajuda.js';

/**
 * Auditoria: TODA rota não pública exige login (401 sem sessão) e uma
 * permissão (403 para um funcionário sem nenhuma permissão). Percorre as
 * rotas registradas no Express, então rota nova sem proteção quebra o teste.
 */
const LIVRES_COM_LOGIN = new Set([
  // Qualquer funcionário logado: o próprio caixa e as listas de apoio
  'GET /caixa/atual',
  'POST /caixa/abrir',
  'POST /caixa/fechar',
  'GET /formas-pagamento/',
  'GET /formas-pagamento/:codigo',
  'GET /dashboard/',
  'GET /permissoes/',
  'GET /permissoes/modelos',
]);

function rotas(): { metodo: string; caminho: string; publico: boolean }[] {
  const lista: { metodo: string; caminho: string; publico: boolean }[] = [];
  for (const m of modulos) {
    const pilha = (
      m.router as unknown as { stack: { route?: { path: string; methods: Record<string, boolean> } }[] }
    ).stack;
    for (const camada of pilha) {
      if (!camada.route) continue;
      for (const metodo of Object.keys(camada.route.methods))
        lista.push({
          metodo: metodo.toUpperCase(),
          caminho: m.caminho + camada.route.path,
          publico: !!m.publico,
        });
    }
  }
  return lista;
}
const concreto = (c: string) => c.replace(/:[A-Za-z]+/g, '01JAAAAAAAAAAAAAAAAAAAAAAA');

const app = criarApp();
let semPermissao: Awaited<ReturnType<typeof entrar>>;
let anonimo: Awaited<ReturnType<typeof entrar>>;
beforeAll(async () => {
  await garantirAdmin();
  await criarUsuario({ login: 'sem-nada', senha: 'Senha12345', permissoes: [] });
  semPermissao = await entrar(app, 'sem-nada', 'Senha12345');
  const request = (await import('supertest')).default;
  anonimo = request.agent(app) as unknown as typeof semPermissao;
});
afterAll(() => fecharPool());

describe('auditoria de permissões', () => {
  const todas = rotas().filter((r) => !r.publico);

  it('encontra as rotas registradas', () => {
    expect(todas.length).toBeGreaterThan(80);
  });

  it('sem sessão: 401 em todas as rotas não públicas', async () => {
    const falhas: string[] = [];
    for (const r of todas) {
      const res = await (anonimo as unknown as Record<string, (u: string) => Test>)[r.metodo.toLowerCase()]!(
        `/api/v1${concreto(r.caminho)}`,
      ).send({});
      if (res.status !== 401) falhas.push(`${r.metodo} ${r.caminho} → ${res.status}`);
    }
    expect(falhas).toEqual([]);
  });

  it('funcionário sem permissões: 403 em todas, exceto as de qualquer funcionário', async () => {
    const falhas: string[] = [];
    for (const r of todas) {
      const chave = `${r.metodo} ${r.caminho}`;
      if (LIVRES_COM_LOGIN.has(chave)) continue;
      const res = await (semPermissao as unknown as Record<string, (u: string) => Test>)[
        r.metodo.toLowerCase()
      ]!(`/api/v1${concreto(r.caminho)}`).send({});
      if (res.status !== 403) falhas.push(`${chave} → ${res.status}`);
    }
    expect(falhas).toEqual([]);
  });
});
