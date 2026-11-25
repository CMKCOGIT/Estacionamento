import { Router } from 'express';
import { z } from 'zod';
import { BackupIndisponivel, backupService } from '../../backup/backup.service.js';
import { registrarAtividade } from '../../db/atividades.js';
import { comTransacao } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { exigirPermissao, metaDaRequisicao } from '../../http/middlewares/autenticacao.js';
import { authRepository } from '../auth/auth.repository.js';
import { conferirSenha } from '../auth/senha.js';

/** Backups do banco (painel → Sistema → Backups). Ver docs/BACKUP.md. */
export const backupRouter = Router();
const gerenciar = exigirPermissao('backup.gerenciar');
const idBackup = (v: unknown) => z.object({ id: z.string().regex(/^[0-9A-Z]{26}$/) }).parse(v).id;

backupRouter.get('/', gerenciar, async (_req, res) => {
  res
    .set('Cache-Control', 'no-store')
    .json({ situacao: await backupService.situacao(), itens: await backupService.listar() });
});

/** Faz um backup agora (sem travar o estacionamento). Responde quando termina. */
backupRouter.post('/', gerenciar, async (req, res) => {
  res.status(201).json(await backupService.criar('MANUAL', req.auth!.id));
});

backupRouter.post('/:id/verificar', gerenciar, async (req, res) => {
  res.json(await backupService.verificar(idBackup(req.params)));
});

backupRouter.post('/:id/testar-restauracao', gerenciar, async (req, res) => {
  res.json(await backupService.testarRestauracao(idBackup(req.params)));
});

/** Baixa o arquivo (cifrado: só abre com a chave do backup, guardada fora do arquivo). */
backupRouter.get('/:id/arquivo', gerenciar, async (req, res) => {
  const id = idBackup(req.params);
  const a = await comErro409(() => backupService.arquivoParaDownload(id));
  await registrarAtividade({
    acao: 'backup.baixado',
    siteId: req.auth!.siteId,
    usuarioId: req.auth!.id,
    entidade: 'backups',
    entidadeId: id,
    dados: { arquivo: a.nome },
    ip: metaDaRequisicao(req).ip,
  });
  res.set('Cache-Control', 'no-store').download(a.caminho, a.nome, { dotfiles: 'allow' });
});

const corpoRestauracao = z.object({
  senha: z.string().min(1, 'Confirme a sua senha').max(200),
  confirmacao: z.literal('RESTAURAR', { message: 'Digite RESTAURAR para confirmar' }),
});

/**
 * Restaura o backup no banco em uso (só Administrador, com a própria senha).
 * Antes, faz um backup de segurança do estado atual.
 */
backupRouter.post('/:id/restaurar', gerenciar, async (req, res) => {
  const id = idBackup(req.params);
  const { senha } = corpoRestauracao.parse(req.body);
  const hash = await comTransacao({}, (c) => authRepository.buscarHashSenha(c, req.auth!.id));
  if (!hash || !(await conferirSenha(hash, senha))) {
    await registrarAtividade({
      acao: 'backup.restauracao_recusada',
      siteId: req.auth!.siteId,
      usuarioId: req.auth!.id,
      entidade: 'backups',
      entidadeId: id,
      dados: { motivo: 'senha_incorreta' },
      ip: metaDaRequisicao(req).ip,
    });
    throw new AppError(422, 'CREDENCIAIS_INVALIDAS', 'Senha incorreta. A restauração não foi feita.');
  }
  const r = await comErro409(() =>
    backupService.restaurarNoBancoAtual(id, req.auth!.id, { ip: metaDaRequisicao(req).ip }),
  );
  res.json(r);
});

async function comErro409<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    if (e instanceof BackupIndisponivel) throw erros.conflito(e.message);
    throw e;
  }
}
