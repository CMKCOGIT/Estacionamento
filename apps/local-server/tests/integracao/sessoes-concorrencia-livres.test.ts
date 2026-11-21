import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, entrar, garantirAdmin } from './ajuda.js';

/**
 * Regressão (auditoria): com vagas livres, entradas simultâneas com vaga
 * automática recebiam "lotado" — a trava com ORDER BY ... LIMIT 1 travava
 * todas as vagas percorridas, e as outras entradas pulavam todas.
 */
const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let base: CadastrosBase;
const entrada = (placa: string) =>
  admin.post('/api/v1/sessoes/entrada').send({ placa, categoriaId: base.categorias.carro });

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 10,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 86_400_000),
    });
  });
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

it('com vagas livres, entradas simultâneas nunca ouvem "lotado"', async () => {
  for (let rodada = 0; rodada < 3; rodada++) {
    const r = await Promise.all(['A', 'B', 'C'].map((x) => entrada(`LV${x}${rodada}A11`)));
    expect(r.map((x) => x.status)).toEqual([201, 201, 201]);
  }
});

it('restando 1 vaga, 4 entradas simultâneas: exatamente 1 entra, cada vaga com um veículo só', async () => {
  const r = await Promise.all(['W', 'X', 'Y', 'Z'].map((x) => entrada(`LV${x}9A11`)));
  const ok = r.filter((x) => x.status === 201);
  expect(ok).toHaveLength(1);
  for (const x of r.filter((y) => y.status !== 201)) expect(x.body.erro.mensagem).toMatch(/lotado/);
  const vagas = (await admin.get('/api/v1/vagas').expect(200)).body.itens as { estado: string }[];
  expect(vagas.filter((v) => v.estado === 'OCUPADA')).toHaveLength(10);
});
