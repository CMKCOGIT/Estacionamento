import { Router, type Request } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import {
  HORAS_APOS_SAIDA_MAX,
  LOGO_MAX_BYTES,
  type ConfiguracoesGerais,
  type SessaoLoginAtiva,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import { obterSiteAtual } from '../../config/site.js';
import { registrarAtividade } from '../../db/atividades.js';
import { pool } from '../../db/pool.js';
import { AppError, erros } from '../../http/erros.js';
import { contextoAuditoria, exigirPermissao, metaDaRequisicao } from '../../http/middlewares/autenticacao.js';
import { authRepository } from '../auth/auth.repository.js';
import { configuracoesService, salvarCategoria, ultimasAlteracoes } from './configuracoes.service.js';
import { carregarConfig, type MapaConfig } from './preferencias.js';

export const configuracoesRouter = Router();
const gerenciar = exigirPermissao('config.gerenciar');

configuracoesRouter.get('/acesso-cliente', gerenciar, async (_req, res) => {
  const site = await obterSiteAtual();
  res.json(await configuracoesService.politicaAcessoCliente(site.id));
});

const schemaPolitica = z.object({
  horasAposSaida: z
    .number({ message: 'Informe o número de horas' })
    .int('Use horas inteiras')
    .min(0, 'Mínimo: 0 (o acesso termina na saída)')
    .max(HORAS_APOS_SAIDA_MAX, `Máximo: ${HORAS_APOS_SAIDA_MAX} horas (7 dias)`),
});

configuracoesRouter.put('/acesso-cliente', gerenciar, async (req, res) => {
  const p = schemaPolitica.parse(req.body);
  res.json(
    await configuracoesService.definirPoliticaAcessoCliente(
      req.auth!.id,
      contextoAuditoria(req, 'política de acesso do cliente'),
      p,
    ),
  );
});

// ---------------------------------------------------------------------------
// Configurações por categoria (Configurações no painel)
// ---------------------------------------------------------------------------
const verGeral = exigirPermissao('config.gerenciar', 'config.seguranca');

const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres`)
    .nullable()
    .transform((v) => v || null);

const schemas = {
  estacionamento: z.object({
    nome: z.string().trim().min(2, 'Informe o nome do estacionamento').max(120),
    endereco: textoOpcional(255),
    telefone: z
      .string()
      .trim()
      .nullable()
      .transform((v) => (v ? v.replace(/\D/g, '') : null))
      .refine((v) => v === null || /^\d{10,11}$/.test(v), 'Telefone com DDD: 10 ou 11 números'),
    horarioFuncionamento: textoOpcional(200),
    logo: z
      .string()
      .nullable()
      .refine(
        (v) => v === null || /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(v),
        'O logotipo deve ser uma imagem PNG, JPEG ou WebP',
      )
      .refine(
        (v) => v === null || Math.floor((v.length - v.indexOf(',') - 1) * 0.75) <= LOGO_MAX_BYTES,
        `O logotipo pode ter no máximo ${LOGO_MAX_BYTES / 1024} KB`,
      ),
  }),
  operacao: z.object({
    vagaAutomatica: z.boolean(),
    mostrarQrNaEntrada: z.boolean(),
    confirmarSaida: z.boolean(),
    alertaPermanenciaHoras: z.number().int().min(0, 'Mínimo 0').max(720, 'Máximo 720 horas (30 dias)'),
  }),
  notificacoes: z.object({
    falhas: z.boolean(),
    backup: z.boolean(),
    sincronizacao: z.boolean(),
    seguranca: z.boolean(),
    operacao: z.boolean(),
  }),
  seguranca: z.object({
    inatividadeMin: z.number().int().min(5, 'Mínimo 5 minutos').max(480, 'Máximo 8 horas'),
    duracaoMaxHoras: z.number().int().min(1, 'Mínimo 1 hora').max(72, 'Máximo 72 horas'),
    maxTentativas: z.number().int().min(3, 'Mínimo 3').max(20, 'Máximo 20'),
    bloqueioMin: z.number().int().min(1, 'Mínimo 1 minuto').max(1440, 'Máximo 24 horas'),
    senhaMinimo: z.number().int().min(8, 'Mínimo 8 caracteres').max(64, 'Máximo 64'),
    senhaExigirMaiuscula: z.boolean(),
    senhaExigirSimbolo: z.boolean(),
    somenteRedeLocal: z.boolean(),
  }),
  limitesAjuste: z.object({
    gerente: z.object({
      percentualMax: z.number().int().min(0).max(100, 'Máximo 100%'),
      valorMaxCentavos: z.number().int().min(0).max(100_000_00),
    }),
    funcionario: z.object({
      percentualMax: z.number().int().min(0).max(100, 'Máximo 100%'),
      valorMaxCentavos: z.number().int().min(0).max(100_000_00),
    }),
  }),
  backup: z.object({
    ativo: z.boolean(),
    horario: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (ex.: 03:00)'),
  }),
};
type CategoriaEditavel = keyof typeof schemas;

const ROTULOS: Record<CategoriaEditavel, string> = {
  estacionamento: 'dados do estacionamento',
  operacao: 'preferências de operação',
  notificacoes: 'notificações',
  seguranca: 'segurança e acessos',
  limitesAjuste: 'limites de desconto',
  backup: 'backup automático',
};

/** Permissão para cada categoria: as críticas são só do Administrador. */
function podeEditar(req: Request, c: CategoriaEditavel): boolean {
  const auth = req.auth!;
  if (c === 'seguranca' || c === 'limitesAjuste') return auth.temPermissao('config.seguranca');
  if (c === 'backup') return auth.temPermissao('backup.gerenciar') && auth.temPermissao('config.seguranca');
  return auth.temPermissao('config.gerenciar');
}

async function montarGerais(req: Request): Promise<ConfiguracoesGerais> {
  const cfg = await carregarConfig(true);
  const site = await obterSiteAtual();
  const auth = req.auth!;
  return {
    estacionamento: { ...cfg.estacionamento, logo: cfg.logo.dataUrl },
    operacao: cfg.operacao,
    notificacoes: cfg.notificacoes,
    acessoCliente: await configuracoesService.politicaAcessoCliente(site.id),
    integracao: {
      configurada: Boolean(env.CLOUD_API_URL && env.SYNC_INTEGRACAO_ID && env.SYNC_SECRET && env.SYNC_ATIVO),
      urlApiExterna: env.CLOUD_API_URL ?? null,
      urlAppCliente: env.PUBLIC_PWA_URL ?? null,
      intervaloEnvioSeg: env.CLOUD_API_URL ? 3 : null,
    },
    ...(auth.temPermissao('config.seguranca') && {
      seguranca: cfg.seguranca,
      limitesAjuste: cfg.limitesAjuste,
    }),
    ...(auth.temPermissao('backup.gerenciar') && { backup: cfg.backup }),
    alteracoes: await ultimasAlteracoes(),
  };
}

configuracoesRouter.get('/', verGeral, async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await montarGerais(req));
});

/**
 * O que toda tela precisa saber (qualquer funcionário logado): nome e logo do
 * estacionamento e as preferências de entrada e saída.
 */
configuracoesRouter.get('/painel', async (_req, res) => {
  const cfg = await carregarConfig();
  res.json({
    nome: cfg.estacionamento.nome,
    logo: cfg.logo.dataUrl,
    operacao: cfg.operacao,
  });
});

configuracoesRouter.put('/:categoria', async (req, res) => {
  const categoria = z
    .enum(Object.keys(schemas) as [CategoriaEditavel, ...CategoriaEditavel[]])
    .parse(req.params.categoria);
  if (!podeEditar(req, categoria)) {
    throw new AppError(403, 'SEM_PERMISSAO', 'Você não tem permissão para alterar estas configurações.');
  }
  const valor = schemas[categoria].parse(req.body) as Record<string, unknown>;
  const contexto = contextoAuditoria(req, ROTULOS[categoria]);
  if (categoria === 'estacionamento') {
    const { logo, ...dados } = valor as { logo: string | null };
    await salvarCategoria('estacionamento', dados as MapaConfig['estacionamento'], req.auth!.id, contexto);
    const atual = (await carregarConfig(true)).logo.dataUrl;
    if (logo !== atual) await salvarCategoria('logo', { dataUrl: logo }, req.auth!.id, contexto);
  } else {
    await salvarCategoria(
      categoria,
      valor as unknown as MapaConfig[typeof categoria],
      req.auth!.id,
      contexto,
    );
  }
  res.json(await montarGerais(req));
});

// ---------------------------------------------------------------------------
// Sessões de login abertas (controle de sessões)
// ---------------------------------------------------------------------------
configuracoesRouter.get('/seguranca/sessoes', exigirPermissao('usuario.sessoes'), async (req, res) => {
  const site = await obterSiteAtual();
  const { seguranca: s } = await carregarConfig();
  const [linhas] = await pool.query<RowDataPacket[]>(
    `SELECT sa.id, u.login, COALESCE(f.nome, u.login) AS nome, sa.ip, sa.user_agent, sa.criado_em,
            sa.ultimo_uso_em, sa.expira_em
       FROM sessoes_acesso sa
       JOIN usuarios u ON u.id = sa.usuario_id
       LEFT JOIN funcionarios f ON f.usuario_id = u.id
      WHERE sa.site_id = ? AND sa.encerrada_em IS NULL AND sa.expira_em > NOW(3)
        AND sa.ultimo_uso_em > NOW(3) - INTERVAL ? MINUTE
      ORDER BY sa.ultimo_uso_em DESC`,
    [site.id, s.inatividadeMin],
  );
  const itens: SessaoLoginAtiva[] = linhas.map((l) => ({
    id: String(l.id),
    usuario: String(l.login),
    nome: String(l.nome),
    ip: (l.ip as string | null) ?? null,
    navegador: (l.user_agent as string | null)?.slice(0, 120) ?? null,
    criadaEm: (l.criado_em as Date).toISOString(),
    ultimoUsoEm: (l.ultimo_uso_em as Date).toISOString(),
    expiraEm: (l.expira_em as Date).toISOString(),
    atual: l.id === req.auth!.sessaoId,
  }));
  res.set('Cache-Control', 'no-store').json({ itens });
});

configuracoesRouter.post(
  '/seguranca/sessoes/:id/encerrar',
  exigirPermissao('usuario.sessoes'),
  async (req, res) => {
    const { id } = z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).parse(req.params);
    if (id === req.auth!.sessaoId)
      throw erros.regraDeNegocio('Para encerrar a sua própria sessão, use Sair.');
    const site = await obterSiteAtual();
    const [[s]] = await pool.query<RowDataPacket[]>(
      'SELECT usuario_id FROM sessoes_acesso WHERE id = ? AND site_id = ? AND encerrada_em IS NULL',
      [id, site.id],
    );
    if (!s) throw erros.naoEncontrado('Sessão não encontrada ou já encerrada');
    await authRepository.encerrarSessao(id, 'REVOGADA');
    await registrarAtividade({
      acao: 'auth.sessao_encerrada',
      siteId: site.id,
      usuarioId: req.auth!.id,
      entidade: 'sessoes_acesso',
      entidadeId: id,
      dados: { usuarioDaSessao: s.usuario_id },
      ip: metaDaRequisicao(req).ip,
    });
    res.status(204).end();
  },
);
