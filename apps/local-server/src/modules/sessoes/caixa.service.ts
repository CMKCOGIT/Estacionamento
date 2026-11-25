import type { RowDataPacket } from 'mysql2/promise';
import { ulid } from 'ulid';
import {
  formatarCentavos,
  type CaixaAtual,
  type ResultadoFechamentoCaixa,
  type FormaPagamento,
  type Posto,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { sessoesRepository as repo } from './sessoes.repository.js';

/**
 * Caixa do operador: abertura, sangria/suprimento e fechamento com conferência.
 * Consultas (resumo, movimentações, caixas de todos) ficam em modules/financeiro.
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

  /**
   * Caixa aberto do operador. Quem não supervisiona caixas recebe os valores
   * ocultos: a conferência do fechamento é às cegas.
   */
  async atual(operadorId: string, mostrarValores = true): Promise<CaixaAtual | null> {
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
      dinheiroEsperadoCentavos: mostrarValores ? Number(dinheiro?.saldo_centavos ?? 0) : null,
      recebidoPorForma: mostrarValores
        ? linhas.map((l) => ({
            forma: String(l.forma_codigo),
            nome: String(l.nome),
            centavos: Number(l.saldo_centavos),
          }))
        : [],
      conferenciaOculta: !mostrarValores,
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
        // Primeiro guichê sem caixa aberto; se todos estiverem em uso, cria o próximo ("Guichê 2"...)
        const [postos] = await c.query<RowDataPacket[]>(
          `SELECT p.id, p.nome, EXISTS (SELECT 1 FROM caixa_sessoes cx WHERE cx.posto_aberto_id = p.id) AS ocupado
             FROM postos p WHERE p.site_id = ? AND p.ativo = TRUE ORDER BY LENGTH(p.nome), p.nome FOR UPDATE`,
          [site.id],
        );
        postoId = (postos.find((p) => !Number(p.ocupado))?.id as string | undefined) ?? null;
        if (!postoId) {
          const [todos] = await c.query<RowDataPacket[]>('SELECT nome FROM postos WHERE site_id = ?', [
            site.id,
          ]);
          let n = todos.length + 1;
          while (todos.some((p) => p.nome === `Guichê ${n}`)) n++;
          postoId = ulid();
          await c.query("INSERT INTO postos (id, site_id, nome, tipo) VALUES (?, ?, ?, 'GUICHE')", [
            postoId,
            site.id,
            `Guichê ${n}`,
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

  /**
   * Fecha o próprio caixa com o dinheiro contado (conferência às cegas: o
   * operador não sabe o esperado). O servidor calcula e grava esperado e
   * diferença; a observação é opcional, porque exigi-la só quando há
   * diferença revelaria ao operador que a conta não bateu.
   */
  async fechar(o: {
    operadorId: string;
    contexto: ContextoAuditoria;
    saldoContadoCentavos: number;
    observacao?: string | null;
  }) {
    const cx = await repo.caixaAbertoDoOperador(pool, o.operadorId);
    if (!cx) throw erros.regraDeNegocio('Você não tem caixa aberto.');
    return this.fecharCaixa({ ...o, caixaId: cx.id, fechadoPor: o.operadorId, exigirJustificativa: false });
  },

  /**
   * Fecha um caixa (o próprio, ou de outro operador por quem supervisiona).
   * O caixa fica travado durante o fechamento: um pagamento que chegue nesse
   * instante espera e é recusado ("caixa fechado"), então o esperado é exato.
   */
  async fecharCaixa(o: {
    caixaId: string;
    fechadoPor: string;
    contexto: ContextoAuditoria;
    saldoContadoCentavos: number;
    observacao?: string | null;
    /** Supervisor (que vê o esperado) precisa explicar a diferença. */
    exigirJustificativa?: boolean;
  }): Promise<ResultadoFechamentoCaixa> {
    const site = await obterSiteAtual();
    return comTransacao(
      { ...o.contexto, motivo: o.observacao?.trim() || 'fechamento de caixa' },
      async (c) => {
        const [[cx]] = await c.query<RowDataPacket[]>(
          `SELECT cx.id, cx.status, cx.aberto_em, p.nome AS posto FROM caixa_sessoes cx
             JOIN postos p ON p.id = cx.posto_id WHERE cx.id = ? AND cx.site_id = ? FOR UPDATE`,
          [o.caixaId, site.id],
        );
        if (!cx) throw erros.naoEncontrado('Caixa não encontrado');
        if (cx.status !== 'ABERTO') throw erros.conflito('Este caixa já foi fechado.');
        const [[d]] = await c.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(saldo_centavos), 0) AS saldo FROM vw_caixa_resumo WHERE caixa_sessao_id = ? AND forma_codigo = 'DINHEIRO'",
          [o.caixaId],
        );
        const esperado = Number(d?.saldo ?? 0);
        const diferenca = o.saldoContadoCentavos - esperado;
        if (o.exigirJustificativa !== false && diferenca !== 0 && !o.observacao?.trim()) {
          throw erros.requisicaoInvalida(
            `Há diferença de ${formatarCentavos(diferenca)} no dinheiro. Explique na observação.`,
            [{ campo: 'observacao', mensagem: 'Obrigatória quando há diferença' }],
          );
        }
        await c.query(
          `UPDATE caixa_sessoes SET status = 'FECHADO', fechado_em = NOW(3), fechado_por = ?, saldo_esperado_centavos = ?,
                saldo_contado_centavos = ?, diferenca_centavos = ?, observacao_fechamento = ?
          WHERE id = ? AND status = 'ABERTO'`,
          [
            o.fechadoPor,
            esperado,
            o.saldoContadoCentavos,
            diferenca,
            o.observacao?.trim() || null,
            o.caixaId,
          ],
        );
        const [[f]] = await c.query<RowDataPacket[]>('SELECT fechado_em FROM caixa_sessoes WHERE id = ?', [
          o.caixaId,
        ]);
        return {
          caixaId: String(cx.id),
          posto: String(cx.posto),
          abertoEm: (cx.aberto_em as Date).toISOString(),
          fechadoEm: (f!.fechado_em as Date).toISOString(),
          esperadoCentavos: esperado,
          contadoCentavos: o.saldoContadoCentavos,
          diferencaCentavos: diferenca,
          conferenciaOculta: false,
        };
      },
    );
  },

  /** Sangria (retirada de dinheiro da gaveta) ou suprimento (reforço de troco) no próprio caixa. */
  async movimentar(o: {
    operadorId: string;
    contexto: ContextoAuditoria;
    tipo: 'SANGRIA' | 'SUPRIMENTO';
    valorCentavos: number;
    descricao: string;
  }) {
    const site = await obterSiteAtual();
    await comTransacao({ ...o.contexto, motivo: o.descricao }, async (c) => {
      const cx = await repo.caixaAbertoDoOperador(c, o.operadorId);
      if (!cx)
        throw new AppError(422, 'REGRA_DE_NEGOCIO', 'Abra o seu caixa primeiro.', { acao: 'ABRIR_CAIXA' });
      await c.query('SELECT id FROM caixa_sessoes WHERE id = ? FOR UPDATE', [cx.id]);
      if (o.tipo === 'SANGRIA') {
        const [[d]] = await c.query<RowDataPacket[]>(
          "SELECT COALESCE(SUM(saldo_centavos), 0) AS saldo FROM vw_caixa_resumo WHERE caixa_sessao_id = ? AND forma_codigo = 'DINHEIRO'",
          [cx.id],
        );
        if (o.valorCentavos > Number(d?.saldo ?? 0)) {
          throw erros.regraDeNegocio(
            `A sangria (${formatarCentavos(o.valorCentavos)}) é maior que o dinheiro do caixa (${formatarCentavos(Number(d?.saldo ?? 0))}).`,
          );
        }
      }
      await c.query(
        `INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo,
                                                descricao, registrado_por, registrado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'DINHEIRO', ?, ?, NOW(3))`,
        [
          ulid(),
          site.id,
          cx.id,
          o.tipo,
          o.tipo === 'SANGRIA' ? 'SAIDA' : 'ENTRADA',
          o.valorCentavos,
          o.descricao,
          o.operadorId,
        ],
      );
    });
    return (await this.atual(o.operadorId))!;
  },
};
