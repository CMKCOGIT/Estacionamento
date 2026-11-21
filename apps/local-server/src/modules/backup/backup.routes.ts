import { Router } from 'express';
import { z } from 'zod';
import { backupService } from '../../backup/backup.service.js';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';

/** Backups do banco (painel → Backups). A restauração é feita fora do servidor (docs/BACKUP.md). */
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
