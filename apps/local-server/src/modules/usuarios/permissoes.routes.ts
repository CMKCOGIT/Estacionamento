import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { NOMES_MODULOS, permissaoCabeNoNivel, type CatalogoPermissoes } from '@estacionamento/shared';
import { registrarAtividade } from '../../db/atividades.js';
import { pool } from '../../db/pool.js';
import { comTransacao } from '../../db/transacao.js';
import { erros } from '../../http/erros.js';
import { contextoAuditoria, exigirPermissao } from '../../http/middlewares/autenticacao.js';

/** Catálogo de permissões agrupado por módulo + modelos prontos. */
export const permissoesRouter = Router();

const ORDEM_MODULOS = Object.keys(NOMES_MODULOS);

permissoesRouter.get(
  '/',
  exigirPermissao('usuario.gerenciar', 'funcionario.gerenciar'),
  async (_req, res) => {
    const [permissoes] = await pool.query<RowDataPacket[]>(
      'SELECT codigo, modulo, descricao FROM permissoes ORDER BY codigo',
    );
    const [modelos] = await pool.query<RowDataPacket[]>(
      `SELECT p.codigo, p.nome, p.descricao, GROUP_CONCAT(pp.permissao_codigo ORDER BY pp.permissao_codigo) AS permissoes
       FROM perfis p LEFT JOIN perfil_permissoes pp ON pp.perfil_id = p.id
      WHERE p.uso = 'MODELO' AND p.ativo = TRUE
      GROUP BY p.id, p.codigo, p.nome, p.descricao
      ORDER BY p.nome`,
    );

    const porModulo = new Map<string, CatalogoPermissoes['modulos'][number]>();
    for (const p of permissoes) {
      const modulo = String(p.modulo);
      if (!porModulo.has(modulo))
        porModulo.set(modulo, { codigo: modulo, nome: NOMES_MODULOS[modulo] ?? modulo, permissoes: [] });
      porModulo.get(modulo)!.permissoes.push({ codigo: p.codigo, modulo, descricao: p.descricao });
    }
    const indice = (m: string) => ORDEM_MODULOS.indexOf(m) + 1 || 99;

    const corpo: CatalogoPermissoes = {
      modulos: [...porModulo.values()].sort((a, b) => indice(a.codigo) - indice(b.codigo)),
      modelos: modelos.map((m) => ({
        codigo: m.codigo,
        nome: m.nome,
        descricao: m.descricao ?? null,
        permissoes: m.permissoes ? String(m.permissoes).split(',') : [],
      })),
    };
    res.json(corpo);
  },
);

/**
 * Permissões padrão de cada nível (Configurações → Usuários e permissões).
 * Só o Administrador altera. Vale para os próximos cadastros: quem já tem
 * acesso mantém as permissões dele.
 */
const MODELO_DO_NIVEL = { padrao_gerente: 'gerente', padrao_operador: 'funcionario' } as const;

permissoesRouter.put('/modelos/:codigo', exigirPermissao('perfil.gerenciar'), async (req, res) => {
  const { codigo } = z.object({ codigo: z.enum(['padrao_gerente', 'padrao_operador']) }).parse(req.params);
  const { permissoes } = z
    .object({ permissoes: z.array(z.string().regex(/^[a-z_]+\.[a-z_]+$/)).max(200) })
    .parse(req.body);
  const nivel = MODELO_DO_NIVEL[codigo];
  const fora = permissoes.filter((p) => !permissaoCabeNoNivel(nivel, p));
  if (fora.length) {
    throw erros.requisicaoInvalida(
      'Estas permissões não cabem neste nível',
      fora.map((p) => ({ campo: 'permissoes', mensagem: p })),
    );
  }
  const unicas = [...new Set(permissoes)];
  await comTransacao(contextoAuditoria(req, `permissões padrão: ${codigo}`), async (c) => {
    const [[perfil]] = await c.query<RowDataPacket[]>(
      "SELECT id FROM perfis WHERE codigo = ? AND uso = 'MODELO' FOR UPDATE",
      [codigo],
    );
    if (!perfil) throw erros.naoEncontrado('Modelo não encontrado');
    if (unicas.length) {
      const [existentes] = await c.query<RowDataPacket[]>(
        'SELECT codigo FROM permissoes WHERE codigo IN (?)',
        [unicas],
      );
      if (existentes.length !== unicas.length) throw erros.requisicaoInvalida('Permissão desconhecida');
    }
    const [antes] = await c.query<RowDataPacket[]>(
      'SELECT permissao_codigo AS p FROM perfil_permissoes WHERE perfil_id = ? ORDER BY 1',
      [perfil.id],
    );
    await c.query('DELETE FROM perfil_permissoes WHERE perfil_id = ?', [perfil.id]);
    if (unicas.length)
      await c.query('INSERT INTO perfil_permissoes (perfil_id, permissao_codigo) VALUES ?', [
        unicas.map((p) => [perfil.id, p]),
      ]);
    await registrarAtividade(
      {
        acao: 'perfil.padrao_alterado',
        siteId: req.auth!.siteId,
        usuarioId: req.auth!.id,
        entidade: 'perfis',
        entidadeId: codigo,
        dados: { antes: antes.map((l) => String(l.p)), depois: unicas.sort() },
      },
      c,
    );
  });
  res.status(204).end();
});
