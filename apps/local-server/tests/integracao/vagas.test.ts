import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Categoria, ListaVagas, Vaga } from '@estacionamento/shared';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { traduzirErroMysql } from '../../src/http/erros-mysql.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { cancelarSessao, registrarEntrada } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let siteId: string;
let usuarioId: string;
let van: Categoria;
let regraVan: string;
let postoId: string;

async function listar(q = ''): Promise<ListaVagas> {
  return (await admin.get(`/api/v1/vagas${q}`).expect(200)).body;
}
const porCodigo = async (codigo: string, q = '?incluirRemovidas=true'): Promise<Vaga | undefined> =>
  (await listar(q)).itens.find((v) => v.codigo === codigo);

async function entrarNaVaga(vagaId: string, placa: string) {
  return comTransacao({ usuarioId }, (c) =>
    registrarEntrada(c, {
      siteId,
      placa,
      categoriaId: van.id,
      vagaId,
      regraId: regraVan,
      operadorId: usuarioId,
      postoId,
      em: new Date(Date.now() - 60_000),
    }),
  );
}

beforeAll(async () => {
  ({ siteId, usuarioId } = await garantirAdmin());
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  const [[p]] = await pool.query<RowDataPacket[]>('SELECT id FROM postos WHERE site_id = ? LIMIT 1', [
    siteId,
  ]);
  postoId = p?.id ?? ulid();
  if (!p)
    await pool.query("INSERT INTO postos (id, site_id, nome) VALUES (?, ?, 'Guichê teste')", [
      postoId,
      siteId,
    ]);
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('categorias', () => {
  it('cria categoria (código normalizado) e recusa repetida', async () => {
    const res = await admin
      .post('/api/v1/categorias')
      .send({ codigo: 'Van ', nome: 'Van / Utilitário' })
      .expect(201);
    van = res.body.itens.find((c: Categoria) => c.codigo === 'VAN');
    expect(van).toMatchObject({ nome: 'Van / Utilitário', ativo: true, capacidade: 0 });
    const dup = await admin.post('/api/v1/categorias').send({ codigo: 'VAN', nome: 'Outra' }).expect(409);
    expect(dup.body.erro.mensagem).toBe('Já existe uma categoria com este código.');

    // Tabela de tarifas com regra para VAN (necessária para registrar entradas nos testes)
    await comTransacao({ usuarioId }, async (c) => {
      const tabela = ulid();
      regraVan = ulid();
      const [[v]] = await c.query<RowDataPacket[]>(
        'SELECT COALESCE(MAX(versao),0)+1 AS v FROM tabelas_tarifa WHERE site_id = ?',
        [siteId],
      );
      await c.query(
        "INSERT INTO tabelas_tarifa (id, site_id, versao, nome, criado_por) VALUES (?, ?, ?, 'Vans', ?)",
        [tabela, siteId, v?.v, usuarioId],
      );
      await c.query(
        'INSERT INTO tarifa_regras (id, tabela_id, categoria_id, primeira_hora_centavos, hora_adicional_centavos) VALUES (?, ?, ?, 1500, 800)',
        [regraVan, tabela, van.id],
      );
      await c.query(
        "UPDATE tabelas_tarifa SET status='PUBLICADA', vigente_desde=NOW(3), publicado_em=NOW(3), publicado_por=? WHERE id=?",
        [usuarioId, tabela],
      );
    });
  });
});

describe('cadastro, edição e identificação', () => {
  it('cadastra uma vaga e registra capacidade, histórico e evento de sincronização', async () => {
    const [[antes]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE tipo = 'vagas.disponibilidade'",
    );
    const res = await admin
      .post('/api/v1/vagas')
      .send({ codigo: ' v-01 ', setor: 'Fundos', categoriaId: van.id })
      .expect(201);
    expect(res.body).toMatchObject({ codigo: 'V-01', estado: 'LIVRE', setor: 'Fundos', temHistorico: false });

    const [[cap]] = await pool.query<RowDataPacket[]>(
      'SELECT capacidade_anterior AS a, capacidade_nova AS n FROM capacidade_alteracoes WHERE categoria_id = ? ORDER BY alterado_em DESC LIMIT 1',
      [van.id],
    );
    expect(cap).toMatchObject({ a: 0, n: 1 });
    const [[depois]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sync_outbox WHERE tipo = 'vagas.disponibilidade'",
    );
    expect(Number(depois?.n)).toBe(Number(antes?.n) + 1);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'vaga.criada' AND entidade_id = ?",
      [res.body.id],
    );
    expect(Number(h?.n)).toBe(1);
  });

  it('código único e válido', async () => {
    const dup = await admin.post('/api/v1/vagas').send({ codigo: 'V-01', categoriaId: van.id }).expect(409);
    expect(dup.body.erro.mensagem).toBe('Já existe uma vaga com este código.');
    await admin.post('/api/v1/vagas').send({ codigo: 'vaga 1!', categoriaId: van.id }).expect(400);
  });

  it('cadastro em lote é tudo-ou-nada', async () => {
    const ok = await admin
      .post('/api/v1/vagas/lote')
      .send({ prefixo: 'V-', inicio: 2, quantidade: 4, digitos: 2, setor: 'Fundos', categoriaId: van.id })
      .expect(201);
    expect(ok.body).toEqual({ criadas: ['V-02', 'V-03', 'V-04', 'V-05'], capacidade: 5 });
    const conflito = await admin
      .post('/api/v1/vagas/lote')
      .send({ prefixo: 'V-', inicio: 5, quantidade: 3, digitos: 2, categoriaId: van.id })
      .expect(409);
    expect(conflito.body.erro.detalhes.codigos).toEqual(['V-05']);
    expect(await porCodigo('V-06')).toBeUndefined();
  });

  it('edita setor, cobertura e observação', async () => {
    const v = (await porCodigo('V-04'))!;
    const res = await admin
      .patch(`/api/v1/vagas/${v.id}`)
      .send({
        codigo: 'V-04',
        setor: 'Coberto',
        categoriaId: van.id,
        coberta: true,
        observacao: 'Perto do elevador',
      })
      .expect(200);
    expect(res.body).toMatchObject({ setor: 'Coberto', coberta: true, observacao: 'Perto do elevador' });
  });

  it('consulta com filtros e resumo por situação', async () => {
    const l = await listar(`?categoriaId=${van.id}`);
    expect(l.resumo).toEqual({ total: 5, livres: 5, ocupadas: 0, bloqueadas: 0, removidas: 0 });
    expect(l.itens.map((v) => v.codigo)).toEqual(['V-04', 'V-01', 'V-02', 'V-03', 'V-05']); // por setor, depois código
    expect((await listar(`?categoriaId=${van.id}&busca=v-0`)).itens).toHaveLength(5);
  });
});

describe('bloqueio e liberação', () => {
  it('bloqueia com motivo e libera', async () => {
    const v = (await porCodigo('V-03'))!;
    await admin.post(`/api/v1/vagas/${v.id}/bloquear`).send({}).expect(400);
    const b = await admin
      .post(`/api/v1/vagas/${v.id}/bloquear`)
      .send({ motivo: 'Buraco no piso' })
      .expect(200);
    expect(b.body).toMatchObject({
      estado: 'BLOQUEADA',
      bloqueio: { motivo: 'Buraco no piso', por: ADMIN.nome },
    });
    expect(
      (await admin.post(`/api/v1/vagas/${v.id}/bloquear`).send({ motivo: 'de novo' }).expect(422)).body.erro
        .mensagem,
    ).toMatch(/já está bloqueada/);
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT motivo FROM historico_atividades WHERE acao = 'vaga.alterada' AND entidade_id = ? ORDER BY id DESC LIMIT 1",
      [v.id],
    );
    expect(h?.motivo).toBe('Buraco no piso');
    const l = await admin.post(`/api/v1/vagas/${v.id}/liberar`).expect(200);
    expect(l.body).toMatchObject({ estado: 'LIVRE', bloqueio: null });
  });

  it('bloquear não altera a capacidade (a vaga continua existindo)', async () => {
    expect((await listar(`?categoriaId=${van.id}`)).resumo.total).toBe(5);
  });
});

describe('ocupação acompanha entradas e saídas', () => {
  let v02: Vaga;
  let sessao: string;

  beforeAll(async () => {
    v02 = (await porCodigo('V-02'))!;
  });

  it('entrada → vermelha (ocupada), com placa e tempo', async () => {
    sessao = await entrarNaVaga(v02.id, 'VAN1A23');
    const v = await porCodigo('V-02');
    expect(v).toMatchObject({ estado: 'OCUPADA', ocupacao: { placa: 'VAN1A23' } });
    expect((await listar(`?categoriaId=${van.id}`)).resumo.ocupadas).toBe(1);
    expect((await listar(`?categoriaId=${van.id}&busca=van1a23`)).itens.map((x) => x.codigo)).toEqual([
      'V-02',
    ]);
  });

  it('a mesma vaga NUNCA recebe dois veículos (o banco recusa)', async () => {
    const erro = await entrarNaVaga(v02.id, 'OUT2B34').catch((e: unknown) => e);
    expect(traduzirErroMysql(erro)).toMatchObject({
      status: 409,
      message: 'Esta vaga já está ocupada por outro veículo.',
    });
  });

  it('nem quando dois operadores registram ao mesmo tempo', async () => {
    const v05 = (await porCodigo('V-05'))!;
    const resultados = await Promise.allSettled([
      entrarNaVaga(v05.id, 'COR1R11'),
      entrarNaVaga(v05.id, 'COR2R22'),
    ]);
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const falha = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(traduzirErroMysql(falha.reason)?.message).toBe('Esta vaga já está ocupada por outro veículo.');
    const [[n]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM sessoes_estacionamento WHERE vaga_id = ? AND status = 'ABERTA'",
      [v05.id],
    );
    expect(Number(n?.n)).toBe(1);
    const sessaoAberta = (await porCodigo('V-05'))!.ocupacao!.sessaoId;
    await comTransacao({ usuarioId }, (c) =>
      cancelarSessao(c, { sessaoId: sessaoAberta, em: new Date(), operadorId: usuarioId, motivo: 'teste' }),
    );
  });

  it('vaga ocupada não pode ser bloqueada, removida nem mudar de categoria', async () => {
    const bloq = await admin.post(`/api/v1/vagas/${v02.id}/bloquear`).send({ motivo: 'teste' }).expect(422);
    expect(bloq.body.erro.mensagem).toBe(
      'A vaga V-02 está ocupada pelo veículo VAN1A23. Registre a saída antes de bloquear.',
    );
    await admin.post(`/api/v1/vagas/${v02.id}/remover`).send({ motivo: 'teste' }).expect(422);
    const outra = (
      await admin.post('/api/v1/categorias').send({ codigo: 'CAMINHAO', nome: 'Caminhão' }).expect(201)
    ).body.itens.find((c: Categoria) => c.codigo === 'CAMINHAO');
    await admin.patch(`/api/v1/vagas/${v02.id}`).send({ codigo: 'V-02', categoriaId: outra.id }).expect(422);
  });

  it('saída → volta a ficar verde (livre)', async () => {
    await comTransacao({ usuarioId }, (c) =>
      cancelarSessao(c, { sessaoId: sessao, em: new Date(), operadorId: usuarioId, motivo: 'teste' }),
    );
    expect(await porCodigo('V-02')).toMatchObject({ estado: 'LIVRE', ocupacao: null, temHistorico: true });
  });
});

describe('exclusão respeitando o histórico', () => {
  it('vaga nunca usada é excluída de verdade', async () => {
    const v = (await porCodigo('V-03'))!;
    const res = await admin
      .post(`/api/v1/vagas/${v.id}/remover`)
      .send({ motivo: 'Área virou passagem' })
      .expect(200);
    expect(res.body).toEqual({ resultado: 'EXCLUIDA', codigo: 'V-03' });
    expect(await porCodigo('V-03')).toBeUndefined();
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT motivo FROM historico_atividades WHERE acao = 'vaga.excluida' AND entidade_id = ?",
      [v.id],
    );
    expect(h?.motivo).toBe('Área virou passagem');
  });

  it('vaga com histórico é desativada (some do mapa, mas os tickets antigos continuam apontando para ela)', async () => {
    const v = (await porCodigo('V-02'))!;
    expect(
      (await admin.post(`/api/v1/vagas/${v.id}/remover`).send({ motivo: 'Reforma' }).expect(200)).body,
    ).toEqual({ resultado: 'DESATIVADA', codigo: 'V-02' });
    expect((await listar(`?categoriaId=${van.id}`)).itens.map((x) => x.codigo)).not.toContain('V-02');
    expect(await porCodigo('V-02')).toMatchObject({ estado: 'REMOVIDA' });
    const det = await admin.get(`/api/v1/vagas/${v.id}`).expect(200);
    expect(det.body.ultimosUsos.length).toBeGreaterThan(0);
    expect(det.body.desativadaEm).toBeTruthy();

    await admin.post(`/api/v1/vagas/${v.id}/reativar`).expect(200);
    expect(await porCodigo('V-02')).toMatchObject({ estado: 'LIVRE' });
  });
});

describe('configuração da capacidade total', () => {
  it('aumenta criando vagas e continuando a numeração', async () => {
    // Atual: V-01, V-02, V-04, V-05 = 4
    const r = await admin
      .put('/api/v1/vagas/capacidade')
      .send({ categoriaId: van.id, capacidade: 6, prefixo: 'V-', setor: 'Fundos', motivo: 'Ampliação' })
      .expect(200);
    expect(r.body).toMatchObject({ anterior: 4, nova: 6, criadas: ['V-06', 'V-07'], reativadas: [] });
  });

  it('reduz removendo bloqueadas e livres; nunca as ocupadas', async () => {
    const v01 = (await porCodigo('V-01'))!;
    await entrarNaVaga(v01.id, 'CAP1A11');
    const v04 = (await porCodigo('V-04'))!;
    await admin.post(`/api/v1/vagas/${v04.id}/bloquear`).send({ motivo: 'Pintura' }).expect(200);

    const r = await admin
      .put('/api/v1/vagas/capacidade')
      .send({ categoriaId: van.id, capacidade: 1, motivo: 'Obra no pátio' })
      .expect(200);
    expect(r.body.anterior).toBe(6);
    expect(r.body.nova).toBe(1);
    // Bloqueada primeiro, depois as livres de código mais alto. V-05 e V-02 já receberam
    // veículos (testes anteriores): são desativadas, não apagadas.
    expect(r.body.excluidas).toEqual(['V-04', 'V-07', 'V-06']);
    expect(r.body.desativadas).toEqual(['V-05', 'V-02']);
    expect(await porCodigo('V-01')).toMatchObject({ estado: 'OCUPADA' });

    const zero = await admin
      .put('/api/v1/vagas/capacidade')
      .send({ categoriaId: van.id, capacidade: 0, motivo: 'teste' })
      .expect(422);
    expect(zero.body.erro.mensagem).toMatch(/há 1 vaga\(s\) ocupada\(s\).*mínimo agora é 1/);
  });

  it('ao aumentar de novo, reativa as removidas antes de criar novas', async () => {
    const r = await admin
      .put('/api/v1/vagas/capacidade')
      .send({ categoriaId: van.id, capacidade: 4, prefixo: 'V-', motivo: 'Fim da obra' })
      .expect(200);
    // Continua a numeração depois do maior código existente (não reaproveita códigos apagados)
    expect(r.body).toMatchObject({ anterior: 1, nova: 4, reativadas: ['V-02', 'V-05'], criadas: ['V-06'] });
    const [[h]] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'vaga.capacidade_alterada'",
    );
    expect(Number(h?.n)).toBeGreaterThan(0);
  });

  it('categoria com vagas não pode ser desativada', async () => {
    const res = await admin
      .patch(`/api/v1/categorias/${van.id}`)
      .send({ nome: van.nome, ativo: false })
      .expect(422);
    expect(res.body.erro.mensagem).toMatch(/Remova ou mude de categoria/);
  });
});

describe('permissões', () => {
  it('consultar não dá direito a alterar; capacidade tem permissão própria', async () => {
    await criarUsuario({ login: 'vaga_leitor', senha: 'Senha12345', permissoes: ['sessao.consultar'] });
    await criarUsuario({ login: 'vaga_gestor', senha: 'Senha12345', permissoes: ['vaga.gerenciar'] });
    const leitor = await entrar(app, 'vaga_leitor', 'Senha12345');
    await leitor.get('/api/v1/vagas').expect(200);
    await leitor.post('/api/v1/vagas').send({ codigo: 'X-1', categoriaId: van.id }).expect(403);
    const gestor = await entrar(app, 'vaga_gestor', 'Senha12345');
    await gestor.post('/api/v1/vagas').send({ codigo: 'V-90', categoriaId: van.id }).expect(201);
    await gestor
      .put('/api/v1/vagas/capacidade')
      .send({ categoriaId: van.id, capacidade: 10, prefixo: 'V-', motivo: 'teste' })
      .expect(403);
  });
});
