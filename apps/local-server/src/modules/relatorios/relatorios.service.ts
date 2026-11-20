import type {
  Agrupamento,
  DetalheMovimentacao,
  PontoFaturamento,
  RelatorioFaturamento,
  RelatorioFechamentos,
  RelatorioFormas,
  RelatorioPendentes,
  TotaisFaturamento,
  ValoresFaturamento,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import { pool } from '../../db/pool.js';
import { erros } from '../../http/erros.js';
import { financeiroRepository } from '../financeiro/financeiro.repository.js';
import { financeiroService } from '../financeiro/financeiro.service.js';
import { sessoesRepository } from '../sessoes/sessoes.repository.js';
import {
  relatoriosRepository as repo,
  type Agregado,
  type AgregadoTickets,
} from './relatorios.repository.js';

// ---------------------------------------------------------------------------
// Datas (AAAA-MM-DD, sem fuso: o dia já é o do estacionamento)
// ---------------------------------------------------------------------------
const DIA_MS = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const texto = (t: number) => new Date(t).toISOString().slice(0, 10);
export const somarDias = (d: string, dias: number) => texto(ms(d) + dias * DIA_MS);
export const diasEntre = (de: string, ate: string) => Math.round((ms(ate) - ms(de)) / DIA_MS) + 1;

/** Primeiro dia do grupo (o próprio dia, a segunda-feira da semana ou o dia 1 do mês). */
export function inicioDoGrupo(d: string, agrupar: Agrupamento): string {
  if (agrupar === 'DIA') return d;
  if (agrupar === 'MES') return `${d.slice(0, 8)}01`;
  const diaSemana = (new Date(ms(d)).getUTCDay() + 6) % 7; // segunda = 0
  return somarDias(d, -diaSemana);
}
function fimDoGrupo(inicio: string, agrupar: Agrupamento): string {
  if (agrupar === 'DIA') return inicio;
  if (agrupar === 'SEMANA') return somarDias(inicio, 6);
  const [a, m] = inicio.split('-').map(Number);
  return texto(Date.UTC(a!, m!, 1) - DIA_MS); // último dia do mês
}

/** Todos os grupos do período, inclusive os sem movimento (o gráfico não "pula" dias). */
export function gruposDoPeriodo(de: string, ate: string, agrupar: Agrupamento) {
  const grupos: { chave: string; inicio: string; fim: string }[] = [];
  for (
    let chave = inicioDoGrupo(de, agrupar);
    chave <= ate;
    chave = somarDias(fimDoGrupo(chave, agrupar), 1)
  ) {
    const fim = fimDoGrupo(chave, agrupar);
    grupos.push({ chave, inicio: chave < de ? de : chave, fim: fim > ate ? ate : fim });
  }
  return grupos;
}

const LIMITE_DIAS: Record<Agrupamento, number> = { DIA: 400, SEMANA: 3 * 366, MES: 5 * 366 };

async function validarPeriodo(de: string, ate: string, agrupar: Agrupamento = 'DIA') {
  const hoje = await financeiroRepository.hojeLocal();
  if (Number.isNaN(ms(de)) || Number.isNaN(ms(ate))) throw erros.requisicaoInvalida('Data inválida.');
  if (de > ate) throw erros.requisicaoInvalida('A data inicial é depois da final.');
  if (de > hoje) throw erros.requisicaoInvalida('O período começa no futuro.');
  const dias = diasEntre(de, ate);
  if (dias > LIMITE_DIAS[agrupar]) {
    const sugestao =
      agrupar === 'DIA' ? ' Agrupe por semana ou mês.' : agrupar === 'SEMANA' ? ' Agrupe por mês.' : '';
    throw erros.requisicaoInvalida(`Período longo demais para este agrupamento (${dias} dias).${sugestao}`);
  }
  return { hoje, dias };
}

// ---------------------------------------------------------------------------
// Faturamento
// ---------------------------------------------------------------------------
const zero = (): ValoresFaturamento => ({
  recebidoCentavos: 0,
  quantidadePagamentos: 0,
  estornadoCentavos: 0,
  quantidadeEstornos: 0,
  liquidoCentavos: 0,
  trocoCentavos: 0,
  ticketsEncerrados: 0,
  ticketsSemCobranca: 0,
  faturadoTicketsCentavos: 0,
  descontosCentavos: 0,
});

function somar(alvo: ValoresFaturamento, rec: Agregado[], est: Agregado[], tks: AgregadoTickets[]) {
  for (const r of rec) {
    alvo.recebidoCentavos += r.total;
    alvo.quantidadePagamentos += r.quantidade;
    alvo.trocoCentavos += r.troco;
  }
  for (const e of est) {
    alvo.estornadoCentavos += e.total;
    alvo.quantidadeEstornos += e.quantidade;
  }
  for (const t of tks) {
    alvo.ticketsEncerrados += t.encerrados;
    alvo.ticketsSemCobranca += t.semCobranca;
    alvo.faturadoTicketsCentavos += t.faturado;
    alvo.descontosCentavos += t.descontos;
  }
  alvo.liquidoCentavos = alvo.recebidoCentavos - alvo.estornadoCentavos;
  return alvo;
}

function totais(v: ValoresFaturamento, dias: number): TotaisFaturamento {
  const pagos = v.ticketsEncerrados - v.ticketsSemCobranca;
  return {
    ...v,
    dias,
    mediaDiariaCentavos: Math.round(v.liquidoCentavos / dias),
    ticketMedioCentavos: pagos > 0 ? Math.round(v.faturadoTicketsCentavos / pagos) : null,
  };
}

async function totaisDoPeriodo(siteId: string, de: string, ate: string): Promise<TotaisFaturamento> {
  const [rec, est, tks] = await Promise.all([
    repo.recebimentos(siteId, de, ate, 'MES'),
    repo.estornos(siteId, de, ate, 'MES'),
    repo.tickets(siteId, de, ate, 'MES'),
  ]);
  return totais(somar(zero(), rec, est, tks), diasEntre(de, ate));
}

export const relatoriosService = {
  async faturamento(de: string, ate: string, agrupar: Agrupamento): Promise<RelatorioFaturamento> {
    const { hoje } = await validarPeriodo(de, ate, agrupar);
    const fim = ate > hoje ? hoje : ate; // não inventa dias futuros
    const site = await obterSiteAtual();
    const [rec, est, tks, nomesFormas, ordem] = await Promise.all([
      repo.recebimentos(site.id, de, fim, agrupar),
      repo.estornos(site.id, de, fim, agrupar),
      repo.tickets(site.id, de, fim, agrupar),
      repo.nomesFormas(),
      repo.ordemFormas(),
    ]);

    const pontos: PontoFaturamento[] = gruposDoPeriodo(de, fim, agrupar).map((g) => {
      const r = rec.filter((x) => x.chave === g.chave);
      const e = est.filter((x) => x.chave === g.chave);
      const valores = somar(
        zero(),
        r,
        e,
        tks.filter((x) => x.chave === g.chave),
      );
      const porForma = ordem
        .map((forma) => ({
          forma,
          liquidoCentavos:
            r.filter((x) => x.forma === forma).reduce((t, x) => t + x.total, 0) -
            e.filter((x) => x.forma === forma).reduce((t, x) => t + x.total, 0),
        }))
        .filter((f) => f.liquidoCentavos !== 0);
      return { inicio: g.inicio, fim: g.fim, ...valores, porForma };
    });

    const dias = diasEntre(de, fim);
    const atual = totais(somar(zero(), rec, est, tks), dias);
    const anteriorAte = somarDias(de, -1);
    const anteriorDe = somarDias(de, -dias);
    const anterior = await totaisDoPeriodo(site.id, anteriorDe, anteriorAte);
    return {
      de,
      ate: fim,
      agrupar,
      pontos,
      totais: atual,
      anterior: { de: anteriorDe, ate: anteriorAte, totais: anterior },
      variacaoLiquidoPct:
        anterior.liquidoCentavos === 0
          ? null
          : Math.round(
              ((atual.liquidoCentavos - anterior.liquidoCentavos) / Math.abs(anterior.liquidoCentavos)) *
                1000,
            ) / 10,
      nomesFormas,
    };
  },

  async formas(de: string, ate: string): Promise<RelatorioFormas> {
    await validarPeriodo(de, ate, 'MES');
    const site = await obterSiteAtual();
    const [rec, est, nomes, ordem] = await Promise.all([
      repo.recebimentos(site.id, de, ate, 'MES'),
      repo.estornos(site.id, de, ate, 'MES'),
      repo.nomesFormas(),
      repo.ordemFormas(),
    ]);
    const linhas = ordem
      .map((forma) => {
        const r = rec.filter((x) => x.forma === forma);
        const e = est.filter((x) => x.forma === forma);
        const quantidade = r.reduce((t, x) => t + x.quantidade, 0);
        const recebido = r.reduce((t, x) => t + x.total, 0);
        const estornado = e.reduce((t, x) => t + x.total, 0);
        return {
          forma,
          nome: nomes[forma] ?? forma,
          quantidade,
          recebidoCentavos: recebido,
          estornadoCentavos: estornado,
          quantidadeEstornos: e.reduce((t, x) => t + x.quantidade, 0),
          liquidoCentavos: recebido - estornado,
          percentual: 0,
          mediaPorPagamentoCentavos: quantidade ? Math.round(recebido / quantidade) : null,
          trocoCentavos: r.reduce((t, x) => t + x.troco, 0),
          parcelasMedia: quantidade
            ? Math.round((r.reduce((t, x) => t + x.parcelas, 0) / quantidade) * 10) / 10
            : null,
        };
      })
      .filter((l) => l.quantidade > 0 || l.estornadoCentavos > 0);
    const liquido = linhas.reduce((t, l) => t + l.liquidoCentavos, 0);
    for (const l of linhas)
      l.percentual = liquido ? Math.round((l.liquidoCentavos / liquido) * 1000) / 10 : 0;
    return {
      de,
      ate,
      formas: linhas.sort((a, b) => b.liquidoCentavos - a.liquidoCentavos),
      totais: {
        quantidade: linhas.reduce((t, l) => t + l.quantidade, 0),
        recebidoCentavos: linhas.reduce((t, l) => t + l.recebidoCentavos, 0),
        estornadoCentavos: linhas.reduce((t, l) => t + l.estornadoCentavos, 0),
        liquidoCentavos: liquido,
      },
    };
  },

  /** Pendentes agora, por tempo de permanência (quanto mais tempo, mais risco). */
  async pendentes(): Promise<RelatorioPendentes> {
    const lista = await financeiroService.pendentes();
    const FAIXAS: [string, number][] = [
      ['Até 1 hora', 60],
      ['1 a 3 horas', 180],
      ['3 a 6 horas', 360],
      ['6 a 24 horas', 1440],
      ['Mais de 24 horas', Infinity],
    ];
    let anterior = 0;
    const faixas = FAIXAS.map(([rotulo, ate]) => {
      const itens = lista.itens.filter((p) => p.permanenciaMin > anterior && p.permanenciaMin <= ate);
      anterior = ate;
      return {
        rotulo,
        quantidade: itens.length,
        totalCentavos: itens.reduce((t, p) => t + p.aPagarCentavos, 0),
      };
    });
    return { ...lista, faixas };
  },

  async fechamentos(de: string, ate: string): Promise<RelatorioFechamentos> {
    await validarPeriodo(de, ate, 'MES');
    const site = await obterSiteAtual();
    const itens = await repo.fechamentos(site.id, de, ate);
    const dif = itens.map((c) => c.diferencaCentavos ?? 0);
    return {
      de,
      ate,
      itens,
      totais: {
        quantidade: itens.length,
        conferidos: dif.filter((d) => d === 0).length,
        comSobra: dif.filter((d) => d > 0).length,
        comFalta: dif.filter((d) => d < 0).length,
        sobraCentavos: dif.filter((d) => d > 0).reduce((t, d) => t + d, 0),
        faltaCentavos: -dif.filter((d) => d < 0).reduce((t, d) => t + d, 0),
        diferencaLiquidaCentavos: dif.reduce((t, d) => t + d, 0),
        recebidoCentavos: itens.reduce((t, c) => t + c.recebidoCentavos, 0),
      },
    };
  },

  /** Detalhe de uma movimentação ou de um pagamento: origem, ticket, caixa, relacionadas e histórico. */
  async detalhe(o: { movimentacaoId?: string; pagamentoId?: string }): Promise<DetalheMovimentacao> {
    const site = await obterSiteAtual();
    const movimentacao = o.movimentacaoId ? await repo.movimentacao(site.id, o.movimentacaoId) : null;
    if (o.movimentacaoId && !movimentacao) throw erros.naoEncontrado('Movimentação não encontrada');
    const pagamentoId = o.pagamentoId ?? movimentacao?.pagamentoId ?? null;
    const pagamento = pagamentoId ? await repo.pagamento(site.id, pagamentoId) : null;
    if (o.pagamentoId && !pagamento) throw erros.naoEncontrado('Pagamento não encontrado');
    const sessaoId = pagamento?.sessaoId ?? movimentacao?.sessaoId ?? null;
    const caixaId = movimentacao?.caixaId ?? pagamento?.caixaId ?? null;
    const [ticket, caixa, relacionadas, historico] = await Promise.all([
      sessaoId ? sessoesRepository.buscarPorId(site.id, sessaoId) : null,
      caixaId ? financeiroRepository.caixa(pool, site.id, caixaId) : null,
      repo.movimentacoesDe(site.id, { pagamentoId, sessaoId }),
      repo.historico([
        ...(movimentacao ? [{ entidade: 'movimentacoes_financeiras', id: movimentacao.id }] : []),
        ...(pagamentoId ? [{ entidade: 'pagamentos', id: pagamentoId }] : []),
        ...(caixaId && movimentacao?.tipo === 'ABERTURA' ? [{ entidade: 'caixa_sessoes', id: caixaId }] : []),
      ]),
    ]);
    return {
      movimentacao,
      pagamento,
      ticket,
      caixa,
      relacionadas: relacionadas.filter((m) => m.id !== movimentacao?.id),
      historico,
    };
  },
};
