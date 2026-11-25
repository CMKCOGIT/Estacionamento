/**
 * Módulos da expansão: níveis Administrador / Gerente / Operador, limite de
 * desconto, configurações por categoria, acesso negado na auditoria,
 * correção de caixa fechado, incidentes LGPD e histórico de movimentações.
 */
import type { RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { criarApp } from '../../src/app.js';
import { fecharPool, pool } from '../../src/db/pool.js';
import { comTransacao } from '../../src/db/transacao.js';
import { limitadorPorIp } from '../../src/modules/auth/auth.service.js';
import { limparCacheConfig } from '../../src/modules/configuracoes/preferencias.js';
import { criarCadastrosBase, type CadastrosBase } from '../../src/modules/demonstracao/cenario.js';
import { ADMIN, criarUsuario, entrar, garantirAdmin } from './ajuda.js';

const app = criarApp();
let admin: Awaited<ReturnType<typeof entrar>>;
let gerente: Awaited<ReturnType<typeof entrar>>;
let operador: Awaited<ReturnType<typeof entrar>>;
let operadorId: string;
let base: CadastrosBase;
let seq = 0;

const novaPlaca = () => `EXP${seq % 10}A${String(seq++).padStart(2, '0')}`;
async function ticketHa(minutos: number, agente = admin) {
  const r = await agente
    .post('/api/v1/sessoes/entrada')
    .send({ placa: novaPlaca(), categoriaId: base.categorias.carro })
    .expect(201);
  const id = r.body.sessao.id as string;
  await pool.query('UPDATE sessoes_estacionamento SET entrada_em = NOW(3) - INTERVAL ? MINUTE WHERE id = ?', [
    minutos,
    id,
  ]);
  return id;
}
const contar = async (sql: string, p: unknown[] = []) =>
  Number((await pool.query<RowDataPacket[]>(sql, p))[0][0]?.n);

beforeAll(async () => {
  const { siteId, usuarioId } = await garantirAdmin();
  admin = await entrar(app, ADMIN.login, ADMIN.senha);
  await comTransacao({ usuarioId }, async (c) => {
    base = await criarCadastrosBase(c, {
      siteId,
      usuarioId,
      vagasCarro: 20,
      vagasMoto: 2,
      vigenteDesde: new Date(Date.now() - 10 * 24 * 3600_000),
    });
  });
  await criarUsuario({
    login: 'gerente.bia',
    senha: 'Painel2026x',
    perfil: 'gerente',
    permissoes: [
      'sessao.entrada',
      'sessao.saida',
      'sessao.consultar',
      'sessao.ajustar_valor',
      'pagamento.registrar',
      'caixa.operar',
      'caixa.supervisionar',
      'auditoria.ver',
      // Só do Administrador: gravada direto no banco, o nível corta
      'backup.gerenciar',
    ],
  });
  gerente = await entrar(app, 'gerente.bia', 'Painel2026x');
  operadorId = await criarUsuario({
    login: 'operador.caio',
    senha: 'Painel2026x',
    permissoes: [
      'sessao.entrada',
      'sessao.saida',
      'sessao.consultar',
      'sessao.ajustar_valor',
      'pagamento.registrar',
      'caixa.operar',
      // Só de gerência: o nível Operador corta
      'relatorio.financeiro',
    ],
  });
  operador = await entrar(app, 'operador.caio', 'Painel2026x');
});
beforeEach(() => limitadorPorIp.limparTudo());
afterAll(() => fecharPool());

describe('níveis de acesso', () => {
  it('o nível é o teto: permissões acima dele não valem, nem gravadas direto no banco', async () => {
    const g = await gerente.get('/api/v1/auth/sessao').expect(200);
    expect(g.body.usuario.perfis).toEqual([{ codigo: 'gerente', nome: 'Gerente' }]);
    expect(g.body.usuario.permissoes).not.toContain('backup.gerenciar');
    await gerente.get('/api/v1/backups').expect(403);

    const o = await operador.get('/api/v1/auth/sessao').expect(200);
    expect(o.body.usuario.permissoes).not.toContain('relatorio.financeiro');
    await operador.get('/api/v1/relatorios/faturamento?de=2026-01-01&ate=2026-01-31').expect(403);
    await operador.get('/api/v1/tarifas').expect(403);
    await operador.get('/api/v1/usuarios').expect(403);
    await operador.get('/api/v1/configuracoes').expect(403);
  });

  it('o cadastro recusa permissões que o nível não permite', async () => {
    const r = await admin
      .post('/api/v1/usuarios')
      .send({
        nome: 'Operador Teste',
        acesso: {
          login: 'op.teste',
          nivel: 'funcionario',
          permissoes: ['sessao.entrada', 'tarifa.publicar'],
          senhaProvisoria: 'Provisoria1',
        },
      })
      .expect(400);
    expect(r.body.erro.detalhes).toEqual([{ campo: 'permissoes', mensagem: 'tarifa.publicar' }]);
    const g = await admin
      .post('/api/v1/usuarios')
      .send({
        nome: 'Gerente Teste',
        acesso: {
          login: 'ger.teste',
          nivel: 'gerente',
          permissoes: ['caixa.supervisionar', 'config.seguranca'],
          senhaProvisoria: 'Provisoria1',
        },
      })
      .expect(400);
    expect(g.body.erro.detalhes).toEqual([{ campo: 'permissoes', mensagem: 'config.seguranca' }]);
  });

  it('gerente não cria gerente nem administrador', async () => {
    await criarUsuario({
      login: 'gerente.rh',
      senha: 'Painel2026x',
      perfil: 'gerente',
      permissoes: ['funcionario.gerenciar', 'usuario.gerenciar', 'sessao.entrada'],
    });
    const rh = await entrar(app, 'gerente.rh', 'Painel2026x');
    const novo = (nivel: string) => ({
      nome: `Pessoa ${nivel}`,
      acesso: { login: `p.${nivel}`, nivel, permissoes: [], senhaProvisoria: 'Provisoria1' },
    });
    await rh.post('/api/v1/usuarios').send(novo('gerente')).expect(403);
    await rh.post('/api/v1/usuarios').send(novo('admin')).expect(403);
    await rh.post('/api/v1/usuarios').send(novo('funcionario')).expect(201);
  });

  it('permissões padrão de cada nível: só o administrador altera, dentro do nível', async () => {
    await gerente.put('/api/v1/permissoes/modelos/padrao_operador').send({ permissoes: [] }).expect(403);
    await admin
      .put('/api/v1/permissoes/modelos/padrao_operador')
      .send({ permissoes: ['sessao.entrada', 'tarifa.publicar'] })
      .expect(400);
    await admin
      .put('/api/v1/permissoes/modelos/padrao_operador')
      .send({ permissoes: ['sessao.entrada', 'sessao.saida'] })
      .expect(204);
    const cat = await admin.get('/api/v1/permissoes').expect(200);
    const modelo = cat.body.modelos.find((m: { codigo: string }) => m.codigo === 'padrao_operador');
    expect(modelo.permissoes).toEqual(['sessao.entrada', 'sessao.saida']);
  });
});

describe('limite de desconto por nível', () => {
  it('operador sem limite não concede desconto; gerente até o percentual; admin sem limite', async () => {
    const id = await ticketHa(61);
    const previa = (agente: typeof admin, desconto: number) =>
      agente.post(`/api/v1/sessoes/${id}/previa-saida`).send({ descontoCentavos: desconto, pagamentos: [] });
    const calculado = (await previa(admin, 0).expect(200)).body.calculo.valorCalculadoCentavos as number;
    expect(calculado).toBeGreaterThan(0);

    const op = await previa(operador, 100).expect(403);
    expect(op.body.erro.codigo).toBe('LIMITE_AJUSTE');

    const metade = Math.floor(calculado / 2);
    await previa(gerente, metade).expect(200);
    const acima = await previa(gerente, metade + 1).expect(403);
    expect(acima.body.erro.detalhes).toEqual({ maximoCentavos: metade });

    await previa(admin, calculado).expect(200);
  });

  it('o administrador muda o limite e vale na hora', async () => {
    await gerente
      .put('/api/v1/configuracoes/limitesAjuste')
      .send({
        gerente: { percentualMax: 100, valorMaxCentavos: 0 },
        funcionario: { percentualMax: 10, valorMaxCentavos: 0 },
      })
      .expect(403);
    await admin
      .put('/api/v1/configuracoes/limitesAjuste')
      .send({
        gerente: { percentualMax: 50, valorMaxCentavos: 0 },
        funcionario: { percentualMax: 10, valorMaxCentavos: 100 },
      })
      .expect(200);
    const id = await ticketHa(61);
    const r = await operador
      .post(`/api/v1/sessoes/${id}/previa-saida`)
      .send({ descontoCentavos: 101, pagamentos: [] })
      .expect(403);
    expect(r.body.erro.detalhes.maximoCentavos).toBeLessThanOrEqual(100);
  });
});

describe('configurações por categoria', () => {
  it('salva e devolve os dados do estacionamento, com validação', async () => {
    await admin
      .put('/api/v1/configuracoes/estacionamento')
      .send({ nome: 'X', endereco: null, telefone: null, horarioFuncionamento: null, logo: null })
      .expect(400);
    await admin
      .put('/api/v1/configuracoes/estacionamento')
      .send({
        nome: 'Estacionamento Central',
        endereco: 'Rua A, 10',
        telefone: '11 99999-0000',
        horarioFuncionamento: 'Seg a sáb, 7h–22h',
        logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
      })
      .expect(400);
    const r = await admin
      .put('/api/v1/configuracoes/estacionamento')
      .send({
        nome: 'Estacionamento Central',
        endereco: 'Rua A, 10',
        telefone: '(11) 99999-0000',
        horarioFuncionamento: 'Seg a sáb, 7h–22h',
        logo: 'data:image/png;base64,iVBORw0KGgo=',
      })
      .expect(200);
    expect(r.body.estacionamento).toMatchObject({ nome: 'Estacionamento Central', telefone: '11999990000' });
    const painel = await operador.get('/api/v1/configuracoes/painel').expect(200);
    expect(painel.body).toMatchObject({
      nome: 'Estacionamento Central',
      logo: 'data:image/png;base64,iVBORw0KGgo=',
    });
    // O histórico guarda o hash do logotipo, não a imagem
    const [h] = await pool.query<RowDataPacket[]>(
      "SELECT dados_novos FROM historico_atividades WHERE entidade = 'configuracoes' AND entidade_id = 'logo' ORDER BY id DESC LIMIT 1",
    );
    expect(JSON.stringify(h[0]?.dados_novos)).toContain('sha256');
    expect(JSON.stringify(h[0]?.dados_novos)).not.toContain('iVBOR');
  });

  it('segurança: só o administrador vê e altera; a regra de senha vale no cadastro', async () => {
    const g = await gerente.get('/api/v1/configuracoes').expect(403);
    expect(g.body.erro.codigo).toBe('SEM_PERMISSAO');
    const atual = (await admin.get('/api/v1/configuracoes').expect(200)).body.seguranca;
    await admin
      .put('/api/v1/configuracoes/seguranca')
      .send({ ...atual, senhaMinimo: 12, senhaExigirSimbolo: true })
      .expect(200);
    const fraca = await admin
      .post('/api/v1/usuarios')
      .send({
        nome: 'Senha Fraca',
        acesso: { login: 'fraca1', nivel: 'funcionario', permissoes: [], senhaProvisoria: 'Provisoria1' },
      })
      .expect(400);
    expect(fraca.body.erro.detalhes.map((d: { mensagem: string }) => d.mensagem)).toEqual([
      'Use pelo menos 12 caracteres',
      'Use pelo menos um símbolo (ex.: ! @ # $)',
    ]);
    const sessao = await admin.get('/api/v1/auth/sessao').expect(200);
    expect(sessao.body.regrasSenha).toEqual({ minimo: 12, exigirMaiuscula: false, exigirSimbolo: true });
    await admin.put('/api/v1/configuracoes/seguranca').send(atual).expect(200);
  });

  it('bloqueio após tentativas configurável', async () => {
    const atual = (await admin.get('/api/v1/configuracoes').expect(200)).body.seguranca;
    await admin
      .put('/api/v1/configuracoes/seguranca')
      .send({ ...atual, maxTentativas: 3 })
      .expect(200);
    await criarUsuario({ login: 'tres.erros', senha: 'Painel2026x' });
    const login = (senha: string) => admin.post('/api/v1/auth/login').send({ login: 'tres.erros', senha });
    await login('errada1').expect(401);
    await login('errada2').expect(401);
    const r = await login('errada3').expect(423);
    expect(r.body.erro.codigo).toBe('CONTA_BLOQUEADA');
    await admin.put('/api/v1/configuracoes/seguranca').send(atual).expect(200);
  });

  it('sessões abertas: o administrador lista e encerra a de outro usuário', async () => {
    const outro = await entrar(app, 'gerente.bia', 'Painel2026x');
    const lista = await admin.get('/api/v1/configuracoes/seguranca/sessoes').expect(200);
    const daBia = lista.body.itens.filter((s: { usuario: string }) => s.usuario === 'gerente.bia');
    expect(daBia.length).toBeGreaterThan(0);
    for (const s of daBia)
      await admin.post(`/api/v1/configuracoes/seguranca/sessoes/${s.id}/encerrar`).expect(204);
    await outro.get('/api/v1/auth/sessao').expect(401);
    gerente = await entrar(app, 'gerente.bia', 'Painel2026x');
  });

  it('notificações desligadas escondem os alertas da categoria', async () => {
    limparCacheConfig();
    await admin
      .put('/api/v1/configuracoes/operacao')
      .send({
        vagaAutomatica: true,
        mostrarQrNaEntrada: true,
        confirmarSaida: true,
        alertaPermanenciaHoras: 1,
      })
      .expect(200);
    await ticketHa(120);
    const com = await admin.get('/api/v1/dashboard').expect(200);
    expect(com.body.alertas.map((a: { codigo: string }) => a.codigo)).toContain('sessoes.longas');
    await admin
      .put('/api/v1/configuracoes/notificacoes')
      .send({ falhas: true, backup: true, sincronizacao: true, seguranca: true, operacao: false })
      .expect(200);
    const sem = await admin.get('/api/v1/dashboard').expect(200);
    expect(sem.body.alertas.map((a: { codigo: string }) => a.codigo)).not.toContain('sessoes.longas');
    await admin
      .put('/api/v1/configuracoes/notificacoes')
      .send({ falhas: true, backup: true, sincronizacao: true, seguranca: true, operacao: true })
      .expect(200);
  });
});

describe('auditoria', () => {
  it('tentativa de acesso sem permissão fica registrada (uma vez a cada 10 min)', async () => {
    await operador.get('/api/v1/atividades').expect(403);
    await operador.get('/api/v1/atividades').expect(403);
    const n = await contar(
      "SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'acesso.negado' AND usuario_id = ? AND dados_novos->>'$.rota' LIKE '%/atividades%'",
      [operadorId],
    );
    expect(n).toBe(1);
    const r = await admin.get('/api/v1/atividades?acao=acesso.negado').expect(200);
    expect(r.body.itens[0].dadosNovos.rota).toBe('GET /api/v1/atividades/');
  });

  it('registros de auditoria não podem ser alterados nem apagados no banco', async () => {
    await expect(pool.query("UPDATE historico_atividades SET acao = 'x.y' LIMIT 1")).rejects.toThrow();
    await expect(pool.query('DELETE FROM historico_atividades LIMIT 1')).rejects.toThrow();
  });

  it('filtro por faixa de horário', async () => {
    const r = await admin.get('/api/v1/atividades?horaDe=00:00&horaAte=23:59').expect(200);
    expect(r.body.itens.length).toBeGreaterThan(0);
    await admin.get('/api/v1/atividades?horaDe=25:00').expect(400);
  });
});

describe('caixa: correção depois do fechamento', () => {
  it('caixa fechado não aceita sangria, mas aceita correção autorizada com motivo', async () => {
    const op2 = await criarUsuario({
      login: 'caixa.dani',
      senha: 'Painel2026x',
      permissoes: ['caixa.operar', 'sessao.entrada'],
    });
    const dani = await entrar(app, 'caixa.dani', 'Painel2026x');
    const cx = await dani.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 5000 }).expect(201);
    await dani
      .post('/api/v1/caixa/fechar')
      .send({ saldoContadoCentavos: 4000, observacao: 'faltou' })
      .expect(200);
    const caixaId = cx.body.id as string;
    expect(op2).toBeTruthy();

    // O banco recusa movimentação comum em caixa fechado
    await expect(
      pool.query(
        `INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, descricao, registrado_por, registrado_em)
         SELECT '01JTESTEMOVFECHADO0000000A', site_id, id, 'SUPRIMENTO', 'ENTRADA', 100, 'DINHEIRO', 'x', operador_id, NOW(3) FROM caixa_sessoes WHERE id = ?`,
        [caixaId],
      ),
    ).rejects.toThrow(/Caixa fechado/);

    await operador
      .post(`/api/v1/financeiro/caixas/${caixaId}/correcoes`)
      .send({ direcao: 'ENTRADA', valorCentavos: 1000, formaCodigo: 'DINHEIRO', motivo: 'Achado na gaveta' })
      .expect(403);
    await gerente
      .post(`/api/v1/financeiro/caixas/${caixaId}/correcoes`)
      .send({ direcao: 'ENTRADA', valorCentavos: 1000, formaCodigo: 'DINHEIRO', motivo: 'x' })
      .expect(400);
    const r = await gerente
      .post(`/api/v1/financeiro/caixas/${caixaId}/correcoes`)
      .send({
        direcao: 'ENTRADA',
        valorCentavos: 1000,
        formaCodigo: 'DINHEIRO',
        motivo: 'Nota achada na gaveta',
      })
      .expect(201);
    // O fechamento original não muda; a correção aparece à parte
    expect(r.body).toMatchObject({
      status: 'FECHADO',
      diferencaCentavos: -1000,
      ajustesCentavos: 1000,
      quantidadeAjustes: 1,
      diferencaCorrigidaCentavos: 0,
    });
    const [[f]] = await pool.query<RowDataPacket[]>(
      'SELECT saldo_contado_centavos, diferenca_centavos FROM caixa_sessoes WHERE id = ?',
      [caixaId],
    );
    expect(f).toMatchObject({ saldo_contado_centavos: 4000, diferenca_centavos: -1000 });
    expect(
      await contar("SELECT COUNT(*) AS n FROM historico_atividades WHERE acao = 'caixa.ajuste'"),
    ).toBeGreaterThan(0);
  });

  it('caixa aberto não aceita correção (usa sangria/suprimento)', async () => {
    const cx = await gerente.post('/api/v1/caixa/abrir').send({ saldoInicialCentavos: 0 }).expect(201);
    await gerente
      .post(`/api/v1/financeiro/caixas/${cx.body.id}/correcoes`)
      .send({ direcao: 'SAIDA', valorCentavos: 100, formaCodigo: 'DINHEIRO', motivo: 'Teste de correção' })
      .expect(422);
  });
});

describe('operação: histórico de movimentações', () => {
  it('supervisor vê todas; operador vê só as dele', async () => {
    await ticketHa(5, operador);
    await ticketHa(5, admin);
    const todas = await gerente.get('/api/v1/sessoes/historico?limite=200').expect(200);
    expect(todas.body.somenteMinhas).toBe(false);
    expect(todas.body.itens.length).toBe(await contar('SELECT COUNT(*) AS n FROM sessoes_estacionamento'));
    const minhas = await operador.get('/api/v1/sessoes/historico?limite=200').expect(200);
    expect(minhas.body.somenteMinhas).toBe(true);
    expect(minhas.body.itens.length).toBeGreaterThan(0);
    expect(
      minhas.body.itens.every(
        (i: { operadorEntrada: string; operadorSaida: string | null }) =>
          i.operadorEntrada === 'operador.caio' || i.operadorSaida === 'operador.caio',
      ),
    ).toBe(true);
    const carro = await gerente
      .get(`/api/v1/sessoes/historico?situacao=ABERTA&categoriaId=${base.categorias.carro}`)
      .expect(200);
    expect(carro.body.itens.every((i: { status: string }) => i.status === 'ABERTA')).toBe(true);
  });
});

describe('LGPD: incidentes e inventário', () => {
  it('registra, acompanha e encerra; encerrado não muda e não pode ser apagado', async () => {
    await operador.get('/api/v1/privacidade/incidentes').expect(403);
    await admin
      .post('/api/v1/privacidade/incidentes')
      .send({
        detectadoEm: new Date(Date.now() + 86_400_000).toISOString(),
        descricao: 'Data no futuro aqui',
        dadosAfetados: 'Placas',
        gravidade: 'BAIXA',
      })
      .expect(400);
    const r = await admin
      .post('/api/v1/privacidade/incidentes')
      .send({
        detectadoEm: new Date().toISOString(),
        descricao: 'Planilha de placas enviada por engano a um fornecedor',
        dadosAfetados: 'Placas de veículos',
        titularesAfetados: 30,
        gravidade: 'MEDIA',
      })
      .expect(201);
    const id = r.body.id as string;
    await admin.patch(`/api/v1/privacidade/incidentes/${id}`).send({ encerrar: true }).expect(400);
    const a = await admin
      .patch(`/api/v1/privacidade/incidentes/${id}`)
      .send({
        medidas: 'Fornecedor apagou o arquivo; envio só por link com senha',
        comunicadoTitulares: true,
        encerrar: true,
      })
      .expect(200);
    expect(a.body).toMatchObject({ status: 'ENCERRADO', titularesAfetados: 30 });
    expect(a.body.comunicadoTitularesEm).not.toBeNull();
    await admin.patch(`/api/v1/privacidade/incidentes/${id}`).send({ gravidade: 'ALTA' }).expect(422);
    await expect(pool.query('DELETE FROM lgpd_incidentes WHERE id = ?', [id])).rejects.toThrow();
  });

  it('inventário mostra as quantidades reais do banco', async () => {
    const r = await admin.get('/api/v1/privacidade/inventario').expect(200);
    const veiculos = r.body.itens.find((i: { categoria: string }) => i.categoria === 'Veículos');
    expect(veiculos.quantidade).toBe(await contar('SELECT COUNT(*) AS n FROM veiculos'));
  });
});

describe('sincronização: fila', () => {
  it('lista pendentes e reenvia (recusados voltam para a fila)', async () => {
    await pool.query(
      "UPDATE sync_outbox SET status = 'REJEITADO', enviado_em = NOW(3), ultimo_erro = 'teste' WHERE status = 'PENDENTE' LIMIT 1",
    );
    const antes = await admin.get('/api/v1/sync/pendentes').expect(200);
    const rejeitados = antes.body.itens.filter((i: { status: string }) => i.status === 'REJEITADO').length;
    expect(rejeitados).toBeGreaterThan(0);
    const r = await admin.post('/api/v1/sync/reenviar').send({}).expect(200);
    expect(r.body.recolocados).toBe(rejeitados);
    expect(await contar("SELECT COUNT(*) AS n FROM sync_outbox WHERE status = 'REJEITADO'")).toBe(0);
  });
});
