import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { registrarErroSistema } from '../../src/monitoramento/erros.js';
import {
  monitoramentoService,
  type PainelMonitoramento,
} from '../../src/monitoramento/monitoramento.service.js';
import { obterSiteAtual } from '../../src/config/site.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;

beforeAll(async () => {
  await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
});
beforeEach(() => {
  limitadorPorIp.limparTudo();
  monitoramentoService.limparCache();
});
afterAll(() => fecharPool());

const painel = async () => (await admin.get('/api/v1/monitoramento').expect(200)).body as PainelMonitoramento;

describe('monitoramento técnico', () => {
  it('mostra servidor, banco, internet, API externa, sincronização e backup', async () => {
    const p = await painel();
    expect(Object.keys(p.componentes).sort()).toEqual(
      ['apiExterna', 'backup', 'banco', 'internet', 'servidor', 'sincronizacao'].sort(),
    );
    expect(p.componentes.banco.nivel).toBe('OK');
    expect(p.componentes.banco.detalhes.latenciaMs).toEqual(expect.any(Number));
    expect(p.componentes.servidor.detalhes.versao).toEqual(expect.any(String));
    expect(['OK', 'ATENCAO', 'FALHA', 'DESLIGADO']).toContain(p.geral);
    // O geral é o pior dos alertas
    if (p.alertas.some((a) => a.nivel === 'FALHA')) expect(p.geral).toBe('FALHA');
  });

  it('erros internos (500) são registrados sem dados pessoais e aparecem no painel', async () => {
    registrarErroSistema({
      origem: 'API',
      codigo: 'ERRO_INTERNO',
      mensagem: 'Falha ao processar a placa ABC1D23 do cliente fulano@exemplo.com',
      metodo: 'POST',
      rota: '/api/v1/sessoes/entrada',
    });
    await new Promise((r) => setTimeout(r, 200));
    const p = await painel();
    const e = p.errosRecentes[0]!;
    expect(e).toMatchObject({ origem: 'API', codigo: 'ERRO_INTERNO', rota: 'POST /api/v1/sessoes/entrada' });
    expect(e.mensagem).not.toContain('ABC1D23');
    expect(e.mensagem).not.toContain('fulano@exemplo.com');
    expect(p.contagens.errosUltimas24h).toBeGreaterThanOrEqual(1);
  });

  it('falhas de comunicação com a nuvem aparecem na lista e nas contagens', async () => {
    const site = await obterSiteAtual();
    await pool.query(
      `INSERT INTO sync_execucoes (site_id, tipo, iniciado_em, finalizado_em, sucesso, erro, http_status)
       VALUES (?, 'PUSH', NOW(3), NOW(3), FALSE, 'connect ECONNREFUSED', NULL)`,
      [site.id],
    );
    const p = await painel();
    expect(p.falhasComunicacao[0]).toMatchObject({ erro: 'connect ECONNREFUSED' });
    expect(p.contagens.falhasSyncUltimas24h).toBeGreaterThanOrEqual(1);
  });

  it('backup atrasado vira alerta com a ação a tomar', async () => {
    await pool.query('DELETE FROM backups');
    const p = await painel();
    expect(p.componentes.backup.nivel).toBe('FALHA');
    expect(p.alertas.find((a) => a.componente === 'Backup')?.acao).toMatch(/48 horas/);
  });

  it('exige a permissão sistema.monitorar', async () => {
    await criarUsuario({ login: 'sem-mon', senha: 'Senha12345', permissoes: ['sessao.entrada'] });
    const sem = await entrar(app, 'sem-mon', 'Senha12345');
    await sem.get('/api/v1/monitoramento').expect(403);
  });
});
