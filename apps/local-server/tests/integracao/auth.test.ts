import type { RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { criarAdministrador } from '../../src/modules/instalacao/instalacao.service.js';
import { ADMIN, criarUsuario, garantirAdmin } from './ajuda.js';

const app = criarApp();
const LOGIN = '/api/v1/auth/login';

async function consultar<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [linhas] = await pool.query<RowDataPacket[]>(sql, params);
  return linhas as T[];
}

beforeAll(() => garantirAdmin());
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('proteção das rotas', () => {
  it('rota administrativa sem login → 401', async () => {
    const res = await request(app).get('/api/v1/formas-pagamento').expect(401);
    expect(res.body.erro.codigo).toBe('NAO_AUTENTICADO');
  });

  it('cookie inventado → 401 SESSAO_EXPIRADA e cookie é apagado', async () => {
    const res = await request(app)
      .get('/api/v1/formas-pagamento')
      .set('Cookie', 'est_sessao=token-que-nao-existe')
      .expect(401);
    expect(res.body.erro.codigo).toBe('SESSAO_EXPIRADA');
    expect(String(res.headers['set-cookie'])).toMatch(/est_sessao=;/);
  });

  it('health continua público', async () => {
    await request(app).get('/api/v1/health').expect(200);
  });
});

describe('login', () => {
  it('senha errada e login inexistente recebem a MESMA resposta genérica', async () => {
    const a = await request(app).post(LOGIN).send({ login: 'admin', senha: 'errada123' }).expect(401);
    const b = await request(app)
      .post(LOGIN)
      .send({ login: 'fulano-nao-existe', senha: 'errada123' })
      .expect(401);
    expect(a.body.erro.codigo).toBe('CREDENCIAIS_INVALIDAS');
    expect(a.body.erro.mensagem).toBe('Usuário ou senha inválidos.');
    expect(b.body.erro.mensagem).toBe(a.body.erro.mensagem);
  });

  it('campos vazios → 400 com detalhes', async () => {
    const res = await request(app).post(LOGIN).send({ login: '', senha: '' }).expect(400);
    expect(res.body.erro.detalhes.map((d: { campo: string }) => d.campo)).toEqual(['login', 'senha']);
  });

  it('login correto: cookie httpOnly + SameSite=Strict, sem token no corpo', async () => {
    const res = await request(app).post(LOGIN).send({ login: ' ADMIN ', senha: ADMIN.senha }).expect(200);
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/est_sessao=[A-Za-z0-9_-]{43};/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Strict/);
    expect(JSON.stringify(res.body)).not.toContain(cookie.split(';')[0]?.split('=')[1]);
    expect(res.body.usuario).toMatchObject({ login: 'admin', nome: ADMIN.nome, deveTrocarSenha: false });
    expect(res.body.usuario.perfis).toEqual([{ codigo: 'admin', nome: 'Administrador' }]);
    expect(res.body.usuario.permissoes).toContain('tarifa.publicar');
    expect(res.body.inatividadeMinutos).toBe(60);
  });

  it('senha guardada com argon2id e sessão guardada só como hash', async () => {
    const [u] = await consultar('SELECT senha_hash FROM usuarios WHERE login = ?', ['admin']);
    expect(u?.senha_hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

    const agente = request.agent(app);
    const res = await agente.post(LOGIN).send({ login: 'admin', senha: ADMIN.senha }).expect(200);
    const token = /est_sessao=([^;]+)/.exec(String(res.headers['set-cookie']))?.[1] ?? '';
    const [s] = await consultar(
      'SELECT HEX(token_hash) AS h FROM sessoes_acesso ORDER BY criado_em DESC LIMIT 1',
    );
    expect(s?.h).toHaveLength(64);
    expect(s?.h).not.toContain(Buffer.from(token).toString('hex').toUpperCase());
  });

  it('registra login e falha no histórico (com IP)', async () => {
    const eventos = await consultar(
      "SELECT acao, ip, origem FROM historico_atividades WHERE acao IN ('auth.login','auth.login_falhou') ORDER BY id",
    );
    expect(eventos.some((e) => e.acao === 'auth.login' && e.origem === 'APP' && e.ip)).toBe(true);
    expect(eventos.some((e) => e.acao === 'auth.login_falhou')).toBe(true);
  });

  it('usuário sem perfil neste estacionamento → 403', async () => {
    await criarUsuario({ login: 'semperfil', senha: 'Senha12345', perfil: null });
    const res = await request(app).post(LOGIN).send({ login: 'semperfil', senha: 'Senha12345' }).expect(403);
    expect(res.body.erro.codigo).toBe('SEM_PERMISSAO');
  });

  it('bloqueia origem de outro site (CSRF)', async () => {
    const res = await request(app)
      .post(LOGIN)
      .set('Origin', 'http://site-malicioso.com')
      .send({ login: 'admin', senha: ADMIN.senha })
      .expect(403);
    expect(res.body.erro.codigo).toBe('ORIGEM_NAO_PERMITIDA');
  });
});

describe('sessão', () => {
  it('logado acessa rotas; logout encerra no servidor na hora', async () => {
    const agente = request.agent(app);
    await agente.post(LOGIN).send({ login: 'admin', senha: ADMIN.senha }).expect(200);
    const sessao = await agente.get('/api/v1/auth/sessao').expect(200);
    expect(sessao.body.usuario.login).toBe('admin');
    await agente.get('/api/v1/formas-pagamento').expect(200);

    await agente.post('/api/v1/auth/logout').expect(204);
    const depois = await agente.get('/api/v1/formas-pagamento').expect(401);
    expect(depois.body.erro.codigo).toBe('NAO_AUTENTICADO'); // cookie foi apagado
    const [s] = await consultar(
      "SELECT motivo_encerramento FROM sessoes_acesso WHERE id = (SELECT entidade_id FROM historico_atividades WHERE acao='auth.logout' ORDER BY id DESC LIMIT 1)",
    );
    expect(s?.motivo_encerramento).toBe('LOGOUT');
  });

  it('logout sem sessão também responde 204', async () => {
    await request(app).post('/api/v1/auth/logout').expect(204);
  });

  it('expira por inatividade', async () => {
    const agente = request.agent(app);
    await agente.post(LOGIN).send({ login: 'admin', senha: ADMIN.senha }).expect(200);
    await pool.query(
      'UPDATE sessoes_acesso SET ultimo_uso_em = NOW(3) - INTERVAL 61 MINUTE WHERE encerrada_em IS NULL ORDER BY criado_em DESC LIMIT 1',
    );
    const res = await agente.get('/api/v1/auth/sessao').expect(401);
    expect(res.body.erro).toMatchObject({
      codigo: 'SESSAO_EXPIRADA',
      mensagem: expect.stringContaining('inatividade'),
    });
  });

  it('expira pelo limite absoluto (turno)', async () => {
    const agente = request.agent(app);
    await agente.post(LOGIN).send({ login: 'admin', senha: ADMIN.senha }).expect(200);
    await pool.query(
      'UPDATE sessoes_acesso SET criado_em = NOW(3) - INTERVAL 13 HOUR, expira_em = NOW(3) - INTERVAL 1 HOUR WHERE encerrada_em IS NULL ORDER BY criado_em DESC LIMIT 1',
    );
    const res = await agente.get('/api/v1/auth/sessao').expect(401);
    expect(res.body.erro.mensagem).toMatch(/expirou/);
  });

  it('usuário desativado perde o acesso imediatamente', async () => {
    const id = await criarUsuario({ login: 'desativado', senha: 'Senha12345' });
    const agente = request.agent(app);
    await agente.post(LOGIN).send({ login: 'desativado', senha: 'Senha12345' }).expect(200);
    await pool.query('UPDATE usuarios SET ativo = FALSE, desativado_em = NOW(3) WHERE id = ?', [id]);
    const res = await agente.get('/api/v1/auth/sessao').expect(401);
    expect(res.body.erro.mensagem).toMatch(/desativado/);
    // E não consegue entrar de novo (mensagem genérica)
    const login = await request(app)
      .post(LOGIN)
      .send({ login: 'desativado', senha: 'Senha12345' })
      .expect(401);
    expect(login.body.erro.codigo).toBe('CREDENCIAIS_INVALIDAS');
  });

  it('níveis de acesso: operador não recebe permissões de admin', async () => {
    await criarUsuario({ login: 'operador1', senha: 'Senha12345', perfil: 'operador' });
    const agente = request.agent(app);
    const res = await agente.post(LOGIN).send({ login: 'operador1', senha: 'Senha12345' }).expect(200);
    expect(res.body.usuario.permissoes).toContain('sessao.entrada');
    expect(res.body.usuario.permissoes).not.toContain('tarifa.publicar');
    expect(res.body.usuario.permissoes).not.toContain('usuario.gerenciar');
  });
});

describe('controle de tentativas', () => {
  it('bloqueia a conta na 5ª senha errada, mesmo com a senha certa depois', async () => {
    const id = await criarUsuario({ login: 'bloqueio', senha: 'Senha12345' });
    for (let i = 1; i <= 4; i++) {
      await request(app)
        .post(LOGIN)
        .send({ login: 'bloqueio', senha: `errada${i}` })
        .expect(401);
    }
    const quinta = await request(app).post(LOGIN).send({ login: 'bloqueio', senha: 'errada5' }).expect(423);
    expect(quinta.body.erro).toMatchObject({
      codigo: 'CONTA_BLOQUEADA',
      detalhes: { segundosParaTentarDeNovo: 900 },
    });
    expect(quinta.body.erro.mensagem).toMatch(/15 minutos/);

    const certa = await request(app).post(LOGIN).send({ login: 'bloqueio', senha: 'Senha12345' }).expect(423);
    expect(certa.body.erro.codigo).toBe('CONTA_BLOQUEADA');

    const [hist] = await consultar(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'usuario.bloqueado' AND entidade_id = ?",
      [id],
    );
    expect(Number(hist?.n)).toBe(1);
  });

  it('após o bloqueio vencer: a senha certa entra e zera o contador', async () => {
    await pool.query(
      "UPDATE usuarios SET bloqueado_ate = NOW(3) - INTERVAL 1 SECOND WHERE login = 'bloqueio'",
    );
    await request(app).post(LOGIN).send({ login: 'bloqueio', senha: 'Senha12345' }).expect(200);
    const [u] = await consultar(
      "SELECT tentativas_falhas, bloqueado_ate FROM usuarios WHERE login = 'bloqueio'",
    );
    expect(u).toMatchObject({ tentativas_falhas: 0, bloqueado_ate: null });
  });

  it('após o bloqueio vencer, a contagem recomeça do zero (sem rebloquear na 1ª falha)', async () => {
    await criarUsuario({ login: 'bloqueio2', senha: 'Senha12345' });
    await pool.query(
      "UPDATE usuarios SET tentativas_falhas = 5, bloqueado_ate = NOW(3) - INTERVAL 1 MINUTE WHERE login = 'bloqueio2'",
    );
    await request(app).post(LOGIN).send({ login: 'bloqueio2', senha: 'errada' }).expect(401);
    const [u] = await consultar(
      "SELECT tentativas_falhas, bloqueado_ate FROM usuarios WHERE login = 'bloqueio2'",
    );
    expect(u).toMatchObject({ tentativas_falhas: 1, bloqueado_ate: null });
  });

  it('limita falhas por computador (IP), mesmo trocando de login', async () => {
    let ultima = 0;
    let corpo: { erro: { codigo: string; detalhes: { segundosParaTentarDeNovo: number } } } | undefined;
    for (let i = 0; i < 25 && ultima !== 429; i++) {
      const res = await request(app)
        .post(LOGIN)
        .send({ login: `inexistente${i}`, senha: 'x1234567' });
      ultima = res.status;
      corpo = res.body;
    }
    expect(ultima).toBe(429);
    expect(corpo?.erro.codigo).toBe('MUITAS_TENTATIVAS');
    expect(corpo?.erro.detalhes.segundosParaTentarDeNovo).toBeGreaterThan(0);
  });
});

describe('troca de senha', () => {
  it('troca obrigatória bloqueia o resto do sistema até ser feita', async () => {
    await criarUsuario({ login: 'novato', senha: 'Provisoria1', deveTrocarSenha: true });
    const agente = request.agent(app);
    const login = await agente.post(LOGIN).send({ login: 'novato', senha: 'Provisoria1' }).expect(200);
    expect(login.body.usuario.deveTrocarSenha).toBe(true);

    const bloqueado = await agente.get('/api/v1/formas-pagamento').expect(403);
    expect(bloqueado.body.erro.codigo).toBe('TROCA_SENHA_OBRIGATORIA');
    await agente.get('/api/v1/auth/sessao').expect(200);

    // Outra sessão aberta do mesmo usuário (outro computador)
    const outro = request.agent(app);
    await outro.post(LOGIN).send({ login: 'novato', senha: 'Provisoria1' }).expect(200);

    const errada = await agente
      .post('/api/v1/auth/trocar-senha')
      .send({ senhaAtual: 'naoeessa1', novaSenha: 'NovaSenha2026' })
      .expect(422);
    expect(errada.body.erro.mensagem).toBe('Senha atual incorreta.');

    const fraca = await agente
      .post('/api/v1/auth/trocar-senha')
      .send({ senhaAtual: 'Provisoria1', novaSenha: 'curta' })
      .expect(400);
    expect(fraca.body.erro.detalhes.length).toBeGreaterThan(0);

    await agente
      .post('/api/v1/auth/trocar-senha')
      .send({ senhaAtual: 'Provisoria1', novaSenha: 'NovaSenha2026' })
      .expect(204);

    await agente.get('/api/v1/formas-pagamento').expect(200); // liberado
    await outro.get('/api/v1/auth/sessao').expect(401); // outra sessão encerrada
    await request(app).post(LOGIN).send({ login: 'novato', senha: 'NovaSenha2026' }).expect(200);
  });
});

describe('configuração inicial (criarAdministrador)', () => {
  it('reaproveita o estacionamento existente e recusa login repetido', async () => {
    const { siteId } = await garantirAdmin();
    const r = await criarAdministrador({ nome: 'Segundo Admin', login: 'admin2', senha: 'OutraSenha9' });
    expect(r).toMatchObject({ siteId, siteCriado: false });
    await expect(
      criarAdministrador({ nome: 'X', login: 'admin2', senha: 'OutraSenha9' }),
    ).rejects.toMatchObject({
      codigo: 'REGISTRO_DUPLICADO',
    });
    await expect(criarAdministrador({ nome: 'X', login: 'admin3', senha: 'fraca' })).rejects.toMatchObject({
      codigo: 'REQUISICAO_INVALIDA',
    });
  });
});
