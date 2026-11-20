import type {
  CaixaDetalhe,
  ListaMovimentacoes,
  ListaPagamentos,
  ListaPendencias,
  ResumoFinanceiroDia,
  TipoMovimentacao,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { erros } from '../../http/erros.js';
import type { Autenticacao } from '../auth/auth.service.js';
import { sessoesRepository } from '../sessoes/sessoes.repository.js';
import { financeiroRepository as repo, type Pagina } from './financeiro.repository.js';

const DIAS_MAXIMOS = 92;

/** Quem vê o financeiro de todos (todos os caixas, pagamentos, resumo). */
export const veTudo = (a: Autenticacao) =>
  a.temPermissao('relatorio.financeiro') || a.temPermissao('caixa.supervisionar');

async function periodo(de?: string, ate?: string): Promise<{ de: string; ate: string }> {
  const hoje = await repo.hojeLocal();
  const p = { de: de ?? ate ?? hoje, ate: ate ?? de ?? hoje };
  if (p.de > p.ate) throw erros.requisicaoInvalida('A data inicial é depois da final.');
  const dias = (Date.parse(p.ate) - Date.parse(p.de)) / 86_400_000;
  if (dias > DIAS_MAXIMOS) throw erros.requisicaoInvalida(`Consulte no máximo ${DIAS_MAXIMOS} dias por vez.`);
  return p;
}

export const financeiroService = {
  /** Tickets abertos com valor a receber agora (calculado pelo motor, relógio do banco). */
  async pendentes(): Promise<ListaPendencias> {
    const site = await obterSiteAtual();
    const abertas = await sessoesRepository.abertas(site.id);
    const itens = abertas
      .filter((s) => s.calculo.aPagarCentavos > 0)
      .map((s) => ({
        sessaoId: s.id,
        numero: s.numero,
        placa: s.placa,
        vaga: s.vaga,
        categoria: s.categoria,
        entradaEm: s.entradaEm,
        permanenciaMin: s.calculo.permanenciaMin,
        valorAcumuladoCentavos: s.calculo.valorCalculadoCentavos,
        pagoCentavos: s.calculo.pagoCentavos,
        aPagarCentavos: s.calculo.aPagarCentavos,
        parcial: s.calculo.pagoCentavos > 0,
      }))
      .sort((a, b) => b.aPagarCentavos - a.aPagarCentavos);
    return {
      calculadoEm: abertas[0]?.calculo.calculadoEm ?? new Date().toISOString(),
      quantidade: itens.length,
      totalCentavos: itens.reduce((t, i) => t + i.aPagarCentavos, 0),
      itens,
    };
  },

  async pagamentos(
    f: {
      de?: string;
      ate?: string;
      forma?: string;
      status?: 'CONFIRMADO' | 'ESTORNADO';
      caixaId?: string;
      sessaoId?: string;
      busca?: string;
    },
    p: Pagina,
  ): Promise<ListaPagamentos> {
    const site = await obterSiteAtual();
    return repo.pagamentos(site.id, { ...f, ...(await periodo(f.de, f.ate)) }, p);
  },

  async movimentacoes(
    f: { de?: string; ate?: string; caixaId?: string; tipo?: TipoMovimentacao; forma?: string },
    p: Pagina,
  ): Promise<ListaMovimentacoes> {
    const site = await obterSiteAtual();
    return repo.movimentacoes(site.id, { ...f, ...(await periodo(f.de, f.ate)) }, p);
  },

  /** Caixas do período. Quem não supervisiona vê só os próprios. */
  async caixas(auth: Autenticacao, f: { de?: string; ate?: string }) {
    const site = await obterSiteAtual();
    const p = await periodo(f.de, f.ate);
    return repo.caixas(site.id, {
      ...p,
      operadorId: veTudo(auth) ? undefined : auth.id,
      incluirAbertos: p.ate >= (await repo.hojeLocal()),
    });
  },

  async caixa(auth: Autenticacao, id: string): Promise<CaixaDetalhe> {
    const site = await obterSiteAtual();
    const cx = await repo.caixa(pool, site.id, id);
    if (!cx || (!veTudo(auth) && cx.operadorId !== auth.id))
      throw erros.naoEncontrado('Caixa não encontrado');
    return { ...cx, movimentacoes: await repo.movimentacoesDoCaixa(pool, id) };
  },

  async resumoDoDia(data?: string): Promise<ResumoFinanceiroDia> {
    const site = await obterSiteAtual();
    const hoje = await repo.hojeLocal();
    const dia = data ?? hoje;
    if (dia > hoje) throw erros.requisicaoInvalida('Escolha hoje ou um dia anterior.');
    const [numeros, caixas, pendentes] = await Promise.all([
      repo.resumoDoDia(site.id, dia),
      repo.caixas(site.id, { de: dia, ate: dia, incluirAbertos: dia === hoje }),
      dia === hoje ? this.pendentes() : Promise.resolve(null),
    ]);
    return {
      ...numeros,
      // Caixas abertos no dia (e, hoje, também os que continuam abertos desde antes)
      caixas,
      pendentes: pendentes && { quantidade: pendentes.quantidade, totalCentavos: pendentes.totalCentavos },
    };
  },
};
