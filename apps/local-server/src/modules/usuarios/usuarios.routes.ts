import { Router, type Request } from 'express';
import { z } from 'zod';
import { POLITICA_SENHA, type Lista, type FuncionarioResumo } from '@estacionamento/shared';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';
import { usuariosService, type Ator } from './usuarios.service.js';

export const usuariosRouter = Router();

const leitura = exigirPermissao('usuario.gerenciar', 'funcionario.gerenciar');
const cadastro = exigirPermissao('funcionario.gerenciar', 'usuario.gerenciar');
const acesso = exigirPermissao('usuario.gerenciar');

const texto = (max: number) => z.string().trim().max(max).nullish();
const dataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato AAAA-MM-DD')
  .nullish()
  .or(z.literal('').transform(() => null));

const schemaDados = z.object({
  nome: z.string().trim().min(1, 'Informe o nome').max(120),
  cpf: texto(14),
  telefone: texto(20),
  email: z
    .email('E-mail inválido')
    .max(160)
    .nullish()
    .or(z.literal('').transform(() => null)),
  cargo: texto(80),
  dataAdmissao: dataIso,
});

const schemaAcesso = z.object({
  login: z.string().trim().min(1, 'Informe o login').max(60),
  nivel: z.enum(['admin', 'funcionario']),
  permissoes: z.array(z.string().max(60)).max(200).default([]),
  senhaProvisoria: z.string().max(POLITICA_SENHA.maximo).optional(),
});

const schemaNovo = schemaDados.extend({ acesso: schemaAcesso.nullish() });

const filtro = z.object({
  busca: z.string().trim().max(80).optional(),
  situacao: z.enum(['ativos', 'inativos', 'todos']).default('ativos'),
  nivel: z.enum(['admin', 'funcionario', 'sem_acesso']).optional(),
});

const parametroId = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/, 'Identificador inválido') });

function ator(req: Request, motivo?: string | null): Ator {
  return { auth: req.auth!, contexto: contextoAuditoria(req, motivo) };
}
const idDe = (req: Request) => parametroId.parse(req.params).id;

usuariosRouter.get('/', leitura, async (req, res) => {
  const itens = await usuariosService.listar(filtro.parse(req.query));
  res.json({ itens } satisfies Lista<FuncionarioResumo>);
});

usuariosRouter.get('/:id', leitura, async (req, res) => {
  res.json(await usuariosService.obter(idDe(req)));
});

usuariosRouter.post('/', cadastro, async (req, res) => {
  const dados = schemaNovo.parse(req.body);
  res.status(201).json(await usuariosService.criar(ator(req, 'cadastro de funcionário'), dados));
});

usuariosRouter.patch('/:id', cadastro, async (req, res) => {
  const dados = schemaDados.parse(req.body);
  res.json(await usuariosService.atualizarDados(ator(req, 'edição de funcionário'), idDe(req), dados));
});

usuariosRouter.put('/:id/acesso', acesso, async (req, res) => {
  const dados = schemaAcesso.parse(req.body);
  res.json(await usuariosService.definirAcesso(ator(req, 'alteração de acesso'), idDe(req), dados));
});

const corpoMotivo = z.object({ motivo: z.string().trim().min(3, 'Informe o motivo').max(255) });

usuariosRouter.post('/:id/desativar', cadastro, async (req, res) => {
  const { motivo } = corpoMotivo.parse(req.body);
  res.json(await usuariosService.desativar(ator(req, motivo), idDe(req)));
});

usuariosRouter.post('/:id/reativar', cadastro, async (req, res) => {
  const { motivo } = corpoMotivo.parse(req.body);
  res.json(await usuariosService.reativar(ator(req, motivo), idDe(req)));
});

usuariosRouter.post('/:id/redefinir-senha', acesso, async (req, res) => {
  const { senhaProvisoria } = z
    .object({ senhaProvisoria: z.string().max(POLITICA_SENHA.maximo) })
    .parse(req.body);
  res.json(
    await usuariosService.redefinirSenha(
      ator(req, 'senha redefinida pelo administrador'),
      idDe(req),
      senhaProvisoria,
    ),
  );
});

usuariosRouter.post('/:id/desbloquear', acesso, async (req, res) => {
  res.json(await usuariosService.desbloquear(ator(req, 'desbloqueio manual'), idDe(req)));
});
