import type { RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { ADMIN, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
const API = '/api/v1/usuarios';
let admin: Awaited<ReturnType<typeof entrar>>;

beforeAll(async () => {
  await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

/** Cria funcionário com acesso e já troca a senha provisória (como no 1º login). */
async function criarFuncionarioComAcesso(login: string, permissoes: string[], nivel = 'funcionario') {
  const res = await admin
    .post(API)
    .send({
      nome: `Fulano ${login}`,
      cargo: 'Operador',
      acesso: { login, nivel, permissoes, senhaProvisoria: 'Provisoria1' },
    })
    .expect(201);
  const agente = await entrar(app, login, 'Provisoria1');
  await agente
    .post('/api/v1/auth/trocar-senha')
    .send({ senhaAtual: 'Provisoria1', novaSenha: 'Definitiva2026' })
    .expect(204);
  return { id: res.body.id as string, usuarioId: res.body.acesso.usuarioId as string, agente };
}

describe('cadastro e consulta', () => {
  it('lista o administrador cadastrado', async () => {
    const res = await admin.get(API).expect(200);
    expect(res.body.itens).toContainEqual(
      expect.objectContaining({
        nome: ADMIN.nome,
        situacao: 'ATIVO',
        acesso: expect.objectContaining({ nivel: 'admin' }),
      }),
    );
  });

  it('cadastra funcionário sem acesso ao sistema e registra no histórico', async () => {
    const res = await admin
      .post(API)
      .send({
        nome: '  Carlos   Manobrista ',
        cpf: '529.982.247-25',
        telefone: '(11) 98888-7777',
        cargo: 'Manobrista',
      })
      .expect(201);
    expect(res.body).toMatchObject({
      nome: 'Carlos Manobrista',
      cpf: '52998224725',
      telefone: '11988887777',
      situacao: 'SEM_ACESSO',
      acesso: null,
    });
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT usuario_id FROM historico_atividades WHERE acao = 'funcionario.cadastrado' AND entidade_id = ?",
      [res.body.id],
    );
    expect(h?.usuario_id).toBeTruthy();
  });

  it.each([
    [{ nome: 'Ze' }, 'nome'],
    [{ nome: 'José Silva', cpf: '111.111.111-11' }, 'cpf'],
    [{ nome: 'José Silva', telefone: '123' }, 'telefone'],
    [{ nome: 'José Silva', email: 'nao-e-email' }, 'email'],
  ])('validação: %o → campo %s', async (corpo, campo) => {
    const res = await admin.post(API).send(corpo).expect(400);
    expect(res.body.erro.detalhes.map((d: { campo: string }) => d.campo)).toContain(campo);
  });

  it('CPF repetido no mesmo estacionamento → 409', async () => {
    const res = await admin.post(API).send({ nome: 'Outro Carlos', cpf: '52998224725' }).expect(409);
    expect(res.body.erro.codigo).toBe('REGISTRO_DUPLICADO');
  });

  it('busca por nome e filtro de nível', async () => {
    const busca = await admin.get(`${API}?busca=manobr`).expect(200);
    expect(busca.body.itens.map((f: { nome: string }) => f.nome)).toEqual(['Carlos Manobrista']);
    const semAcesso = await admin.get(`${API}?nivel=sem_acesso`).expect(200);
    expect(semAcesso.body.itens.every((f: { acesso: unknown }) => f.acesso === null)).toBe(true);
  });

  it('catálogo de permissões agrupado por módulo, com modelos', async () => {
    const res = await admin.get('/api/v1/permissoes').expect(200);
    expect(res.body.modulos[0]).toMatchObject({ codigo: 'sessoes', nome: 'Entrada e saída de veículos' });
    expect(res.body.modelos.map((m: { nome: string }) => m.nome)).toEqual([
      'Financeiro',
      'Operador de caixa',
    ]);
  });
});

describe('níveis de acesso e permissões por funcionalidade', () => {
  it('funcionário só acessa o que foi marcado', async () => {
    const { agente } = await criarFuncionarioComAcesso('caixa1', ['sessao.entrada', 'sessao.saida']);
    const sessao = await agente.get('/api/v1/auth/sessao').expect(200);
    expect(sessao.body.usuario.permissoes).toEqual(['sessao.entrada', 'sessao.saida']);
    expect(sessao.body.usuario.perfis).toEqual([{ codigo: 'funcionario', nome: 'Funcionário' }]);
    const negado = await agente.get(API).expect(403);
    expect(negado.body.erro.codigo).toBe('SEM_PERMISSAO');
    await agente.get('/api/v1/atividades').expect(403);
  });

  it('nova senha provisória exige troca no primeiro login', async () => {
    await admin
      .post(API)
      .send({
        nome: 'Novo Funcionario',
        acesso: { login: 'novo1', nivel: 'funcionario', permissoes: [], senhaProvisoria: 'Provisoria1' },
      })
      .expect(201);
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'novo1', senha: 'Provisoria1' })
      .expect(200);
    expect(res.body.usuario.deveTrocarSenha).toBe(true);
  });

  it('mudança de permissões vale na hora para a sessão aberta', async () => {
    const { id, agente } = await criarFuncionarioComAcesso('caixa2', ['sessao.entrada']);
    await admin
      .put(`${API}/${id}/acesso`)
      .send({ login: 'caixa2', nivel: 'funcionario', permissoes: ['sessao.entrada', 'auditoria.ver'] })
      .expect(200);
    const sessao = await agente.get('/api/v1/auth/sessao').expect(200);
    expect(sessao.body.usuario.permissoes).toEqual(['auditoria.ver', 'sessao.entrada']);
    await agente.get('/api/v1/atividades').expect(200);

    const [hist] = await pool.query<RowDataPacket[]>(
      "SELECT dados_novos->>'$.permissao' AS p FROM historico_atividades WHERE acao = 'usuario.permissao_concedida' AND entidade_id LIKE ?",
      [`%:auditoria.ver`],
    );
    expect(hist.map((h) => h.p)).toContain('auditoria.ver');
  });

  it('promover a Administrador dá todas as permissões', async () => {
    const { id, agente } = await criarFuncionarioComAcesso('gerente1', ['sessao.entrada']);
    await admin
      .put(`${API}/${id}/acesso`)
      .send({ login: 'gerente1', nivel: 'admin', permissoes: [] })
      .expect(200);
    const sessao = await agente.get('/api/v1/auth/sessao').expect(200);
    expect(sessao.body.usuario.permissoes).toContain('tarifa.publicar');
    expect(sessao.body.usuario.permissoes).toContain('usuario.gerenciar');
  });

  it('valida permissões, login e senha provisória', async () => {
    const desconhecida = await admin
      .post(API)
      .send({
        nome: 'Teste Um',
        acesso: {
          login: 'teste1',
          nivel: 'funcionario',
          permissoes: ['nao.existe'],
          senhaProvisoria: 'Provisoria1',
        },
      })
      .expect(400);
    expect(desconhecida.body.erro.mensagem).toBe('Permissão desconhecida');

    const loginRepetido = await admin
      .post(API)
      .send({
        nome: 'Teste Dois',
        acesso: { login: 'ADMIN', nivel: 'funcionario', permissoes: [], senhaProvisoria: 'Provisoria1' },
      })
      .expect(409);
    expect(loginRepetido.body.erro.mensagem).toMatch(/já está em uso/);

    await admin
      .post(API)
      .send({ nome: 'Teste Tres', acesso: { login: 'teste3', nivel: 'funcionario', permissoes: [] } })
      .expect(400);
    // nada foi gravado pela metade
    const lista = await admin.get(`${API}?busca=Teste`).expect(200);
    expect(lista.body.itens).toHaveLength(0);
  });
});

describe('proteções contra escalada de privilégio', () => {
  let supervisor: Awaited<ReturnType<typeof criarFuncionarioComAcesso>>;

  beforeAll(async () => {
    supervisor = await criarFuncionarioComAcesso('supervisor', [
      'usuario.gerenciar',
      'funcionario.gerenciar',
      'sessao.entrada',
    ]);
  });

  it('pode conceder apenas permissões que ele próprio tem', async () => {
    await supervisor.agente
      .post(API)
      .send({
        nome: 'Ajudante Um',
        acesso: {
          login: 'ajud1',
          nivel: 'funcionario',
          permissoes: ['sessao.entrada'],
          senhaProvisoria: 'Provisoria1',
        },
      })
      .expect(201);
    const res = await supervisor.agente
      .post(API)
      .send({
        nome: 'Ajudante Dois',
        acesso: {
          login: 'ajud2',
          nivel: 'funcionario',
          permissoes: ['tarifa.publicar'],
          senhaProvisoria: 'Provisoria1',
        },
      })
      .expect(403);
    expect(res.body.erro.detalhes).toEqual({ naoPermitidas: ['tarifa.publicar'] });
  });

  it('não pode criar Administrador nem mexer em Administrador', async () => {
    await supervisor.agente
      .post(API)
      .send({
        nome: 'Chefe Falso',
        acesso: { login: 'chefe', nivel: 'admin', permissoes: [], senhaProvisoria: 'Provisoria1' },
      })
      .expect(403);
    const lista = await admin.get(`${API}?nivel=admin`).expect(200);
    const idAdmin = lista.body.itens.find((f: { nome: string }) => f.nome === ADMIN.nome).id;
    await supervisor.agente.patch(`${API}/${idAdmin}`).send({ nome: 'Hackeado' }).expect(403);
    await supervisor.agente.post(`${API}/${idAdmin}/desativar`).send({ motivo: 'tentativa' }).expect(403);
    await supervisor.agente
      .post(`${API}/${idAdmin}/redefinir-senha`)
      .send({ senhaProvisoria: 'Provisoria1' })
      .expect(403);
  });

  it('ninguém altera o próprio acesso nem se desativa', async () => {
    const proprio = await supervisor.agente
      .put(`${API}/${supervisor.id}/acesso`)
      .send({
        login: 'supervisor',
        nivel: 'funcionario',
        permissoes: ['usuario.gerenciar', 'funcionario.gerenciar', 'sessao.entrada'],
      })
      .expect(403);
    expect(proprio.body.erro.mensagem).toMatch(/próprio/);

    const lista = await admin.get(`${API}?nivel=admin`).expect(200);
    const idAdmin = lista.body.itens.find((f: { nome: string }) => f.nome === ADMIN.nome).id;
    const desativarAdmin = await admin
      .post(`${API}/${idAdmin}/desativar`)
      .send({ motivo: 'teste' })
      .expect(403);
    expect(desativarAdmin.body.erro.mensagem).toMatch(/próprio/);
  });
});

describe('desativação, senha e bloqueio', () => {
  it('desativar encerra a sessão na hora; reativar libera de novo', async () => {
    const { id, agente } = await criarFuncionarioComAcesso('temporario', ['sessao.entrada']);
    await admin.post(`${API}/${id}/desativar`).send({ motivo: 'fim do contrato' }).expect(200);
    await agente.get('/api/v1/auth/sessao').expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'temporario', senha: 'Definitiva2026' })
      .expect(401);

    const detalhe = await admin.get(`${API}/${id}`).expect(200);
    expect(detalhe.body).toMatchObject({ ativo: false, situacao: 'INATIVO' });
    expect(detalhe.body.dataDesligamento).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT motivo FROM historico_atividades WHERE acao = 'funcionario.desligado' AND entidade_id = ?",
      [id],
    );
    expect(h?.motivo).toBe('fim do contrato');

    await admin.post(`${API}/${id}/reativar`).send({ motivo: 'recontratado' }).expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'temporario', senha: 'Definitiva2026' })
      .expect(200);
  });

  it('desativar exige motivo', async () => {
    const { id } = await criarFuncionarioComAcesso('semmotivo', []);
    await admin.post(`${API}/${id}/desativar`).send({}).expect(400);
  });

  it('redefinir senha derruba as sessões e obriga a trocar no próximo login', async () => {
    const { id, agente } = await criarFuncionarioComAcesso('esqueceu', ['sessao.entrada']);
    await admin.post(`${API}/${id}/redefinir-senha`).send({ senhaProvisoria: 'Temporaria9' }).expect(200);
    await agente.get('/api/v1/auth/sessao').expect(401);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'esqueceu', senha: 'Temporaria9' })
      .expect(200);
    expect(login.body.usuario.deveTrocarSenha).toBe(true);
  });

  it('desbloquear libera a conta antes do prazo', async () => {
    const { id } = await criarFuncionarioComAcesso('travado', ['sessao.entrada']);
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ login: 'travado', senha: `errada${i}x` });
    }
    expect((await admin.get(`${API}/${id}`)).body.situacao).toBe('BLOQUEADO');
    await admin.post(`${API}/${id}/desbloquear`).expect(200);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ login: 'travado', senha: 'Definitiva2026' })
      .expect(200);
  });
});

describe('histórico de atividades', () => {
  it('lista com nome de quem fez, filtra por módulo e pagina', async () => {
    const res = await admin.get('/api/v1/atividades?modulo=funcionario&limite=2').expect(200);
    expect(res.body.itens).toHaveLength(2);
    expect(res.body.itens[0].acao).toMatch(/^funcionario\./);
    expect(res.body.itens[0].usuario).toMatchObject({ nome: ADMIN.nome });
    expect(res.body.proximaPagina).toBeTruthy();

    const prox = await admin.get(
      `/api/v1/atividades?modulo=funcionario&limite=2&antesDe=${res.body.proximaPagina}`,
    );
    expect(Number(prox.body.itens[0].id)).toBeLessThan(Number(res.body.proximaPagina));
  });

  it('registra login, alterações administrativas e permissões', async () => {
    const res = await admin.get('/api/v1/atividades?limite=200').expect(200);
    const acoes = new Set(res.body.itens.map((a: { acao: string }) => a.acao));
    for (const a of [
      'auth.login',
      'funcionario.cadastrado',
      'funcionario.desligado',
      'usuario.criado',
      'usuario.permissao_concedida',
      'usuario.senha_redefinida',
      'usuario.desbloqueado',
    ]) {
      expect(acoes).toContain(a);
    }
  });
});
