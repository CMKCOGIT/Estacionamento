import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import { formatarCentavos, type CaixaAtual, type FormaPagamento, type Posto } from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { erros } from '../../http/erros.js';
import { sessoesRepository as repo } from './sessoes.repository.js';

/**
 * Caixa do operador — o mínimo para a saída registrar pagamentos.
 * (Sangria, suprimento, conferência e relatórios ficam no módulo de Caixa.)
 */
export const caixaService = {
  async postos(): Promise<Posto[]> {
    const site = await obterSiteAtual();
    const [l] = await pool.query<RowDataPacket[]>(
      'SELECT id, nome FROM postos WHERE site_id = ? AND ativo = TRUE ORDER BY nome',
      [site.id],
    );
    return l.map((x) => ({ id: String(x.id), nome: String(x.nome) }));
  },

  async formas(): Promise<FormaPagamento[]> {
    const [l] = await pool.query<RowDataPacket[]>(
      'SELECT codigo, nome, permite_troco, exige_autorizacao, permite_parcelas, ordem FROM formas_pagamento WHERE ativo = TRUE ORDER BY ordem',
    );
    return l.map((x) => ({
      codigo: String(x.codigo),
      nome: String(x.nome),
      permiteTroco: Boolean(Number(x.permite_troco)),
      exigeAutorizacao: Boolean(Number(x.exige_autorizacao)),
      permiteParcelas: Boolean(Number(x.permite_parcelas)),
      ativo: true,
      ordem: Number(x.ordem),
    }));
  },

  async atual(operadorId: string): Promise<CaixaAtual | null> {
    const cx = await repo.caixaAbertoDoOperador(pool, operadorId);
    if (!cx) return null;
    const [linhas] = await pool.query<RowDataPacket[]>(
      `SELECT r.forma_codigo, f.nome, r.saldo_centavos FROM vw_caixa_resumo r JOIN formas_pagamento f ON f.codigo = r.forma_codigo
        WHERE r.caixa_sessao_id = ? ORDER BY f.ordem`,
      [cx.id],
    );
    const dinheiro = linhas.find((l) => l.forma_codigo === 'DINHEIRO');
    return {
      id: cx.id,
      postoId: cx.postoId,
      posto: cx.posto,
      abertoEm: cx.abertoEm.toISOString(),
      saldoInicialCentavos: cx.saldoInicial,
      dinheiroEsperadoCentavos: Number(dinheiro?.saldo_centavos ?? 0),
      recebidoPorForma: linhas.map((l) => ({
        forma: String(l.forma_codigo),
        nome: String(l.nome),
        centavos: Number(l.saldo_centavos),
      })),
    };
  },

  async abrir(o: {
    operadorId: string;
    contexto: ContextoAuditoria;
    postoId?: string | null;
    saldoInicialCentavos: number;
  }): Promise<CaixaAtual> {
    const site = await obterSiteAtual();
    await comTransacao({ ...o.contexto, motivo: 'abertura de caixa' }, async (c) => {
      let postoId = o.postoId ?? null;
      if (!postoId) {
        const [[p]] = await c.query<RowDataPacket[]>(
          'SELECT id FROM postos WHERE site_id = ? AND ativo = TRUE ORDER BY nome LIMIT 1',
          [site.id],
        );
        postoId = (p?.id as string | undefined) ?? null;
        if (!postoId) {
          // Primeira vez: cria o posto padrão
          postoId = ulid();
          await c.query("INSERT INTO postos (id, site_id, nome, tipo) VALUES (?, ?, 'Guichê 1', 'GUICHE')", [
            postoId,
            site.id,
          ]);
        }
      }
      const id = ulid();
      await c.query(
        'INSERT INTO caixa_sessoes (id, site_id, posto_id, operador_id, aberto_em, saldo_inicial_centavos) VALUES (?, ?, ?, ?, NOW(3), ?)',
        [id, site.id, postoId, o.operadorId, o.saldoInicialCentavos],
      );
      if (o.saldoInicialCentavos > 0) {
        await c.query(
          "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, descricao, registrado_por, registrado_em) VALUES (?, ?, ?, 'ABERTURA', 'ENTRADA', ?, 'DINHEIRO', 'Troco inicial', ?, NOW(3))",
          [ulid(), site.id, id, o.saldoInicialCentavos, o.operadorId],
        );
      }
    });
    return (await this.atual(o.operadorId))!;
  },

  /** Fecha o caixa com o dinheiro contado; a diferença fica registrada. */
  async fechar(o: {
    operadorId: string;
    contexto: ContextoAuditoria;
    saldoContadoCentavos: number;
    observacao?: string | null;
  }) {
    const cx = await this.atual(o.operadorId);
    if (!cx) throw erros.regraDeNegocio('Você não tem caixa aberto.');
    const diferenca = o.saldoContadoCentavos - cx.dinheiroEsperadoCentavos;
    if (diferenca !== 0 && !o.observacao?.trim()) {
      throw erros.requisicaoInvalida(
        `Há diferença de ${formatarCentavos(diferenca)} no dinheiro. Explique na observação.`,
        [{ campo: 'observacao', mensagem: 'Obrigatória quando há diferença' }],
      );
    }
    await comTransacao({ ...o.contexto, motivo: o.observacao ?? 'fechamento de caixa' }, (c) =>
      c.query(
        `UPDATE caixa_sessoes SET status = 'FECHADO', fechado_em = NOW(3), fechado_por = ?, saldo_esperado_centavos = ?,
                saldo_contado_centavos = ?, diferenca_centavos = ?, observacao_fechamento = ?
          WHERE id = ? AND status = 'ABERTO'`,
        [
          o.operadorId,
          cx.dinheiroEsperadoCentavos,
          o.saldoContadoCentavos,
          diferenca,
          o.observacao?.trim() || null,
          cx.id,
        ],
      ),
    );
    return {
      esperadoCentavos: cx.dinheiroEsperadoCentavos,
      contadoCentavos: o.saldoContadoCentavos,
      diferencaCentavos: diferenca,
    };
  },
};
