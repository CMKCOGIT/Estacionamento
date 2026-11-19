import type { RowDataPacket } from 'mysql2/promise';
import type { FormaPagamento } from '@estacionamento/shared';
import { pool } from '../../db/pool.js';

interface LinhaFormaPagamento extends RowDataPacket {
  codigo: string;
  nome: string;
  permite_troco: number;
  exige_autorizacao: number;
  permite_parcelas: number;
  ativo: number;
  ordem: number;
}

/** Converte a linha do banco (snake_case, TINYINT) no contrato da API. */
function paraFormaPagamento(l: LinhaFormaPagamento): FormaPagamento {
  return {
    codigo: l.codigo,
    nome: l.nome,
    permiteTroco: Boolean(l.permite_troco),
    exigeAutorizacao: Boolean(l.exige_autorizacao),
    permiteParcelas: Boolean(l.permite_parcelas),
    ativo: Boolean(l.ativo),
    ordem: l.ordem,
  };
}

const COLUNAS = 'codigo, nome, permite_troco, exige_autorizacao, permite_parcelas, ativo, ordem';

export const formasPagamentoRepository = {
  async listar(filtro: { somenteAtivas: boolean }): Promise<FormaPagamento[]> {
    const [linhas] = await pool.query<LinhaFormaPagamento[]>(
      `SELECT ${COLUNAS} FROM formas_pagamento ${filtro.somenteAtivas ? 'WHERE ativo = TRUE' : ''} ORDER BY ordem, nome`,
    );
    return linhas.map(paraFormaPagamento);
  },

  async buscarPorCodigo(codigo: string): Promise<FormaPagamento | null> {
    const [linhas] = await pool.query<LinhaFormaPagamento[]>(
      `SELECT ${COLUNAS} FROM formas_pagamento WHERE codigo = ?`,
      [codigo],
    );
    return linhas[0] ? paraFormaPagamento(linhas[0]) : null;
  },
};
