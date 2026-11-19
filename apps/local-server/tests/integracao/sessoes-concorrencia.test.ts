import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let base: CadastrosBase;

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 3,
      vagasMoto: 1,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 3600_000),
    });
  });
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

it('muitas entradas simultâneas: cada vaga recebe um veículo só, o resto ouve "lotado"', async () => {
  const placas = ['SIM1A01', 'SIM1A02', 'SIM1A03', 'SIM1A04', 'SIM1A05', 'SIM1A06', 'SIM1A07', 'SIM1A08'];
  const r = await Promise.all(
    placas.map((placa) =>
      admin.post('/api/v1/sessoes/entrada').send({ placa, categoriaId: base.categorias.carro }),
    ),
  );
  const ok = r.filter((x) => x.status === 201);
  expect(ok).toHaveLength(3);
  expect(new Set(ok.map((x) => x.body.sessao.vaga))).toEqual(new Set(['A-01', 'A-02', 'A-03']));
  for (const x of r.filter((y) => y.status !== 201)) {
    expect(x.status).toBe(422);
    expect(x.body.erro.mensagem).toMatch(/Não há vagas disponíveis para Carro/);
  }
});
