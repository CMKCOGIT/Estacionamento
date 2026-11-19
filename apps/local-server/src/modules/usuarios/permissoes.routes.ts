import { Router } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { NOMES_MODULOS, type CatalogoPermissoes } from '@estacionamento/shared';
import { pool } from '../../db/pool.js';
import { exigirPermissao } from '../../http/middlewares/autenticacao.js';

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
