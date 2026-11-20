import { createHash } from 'node:crypto';
import { calcularEstadia, minutosDePermanencia } from '@estacionamento/calculo';
import {
  PADRAO_TOKEN_TICKET,
  type DisponibilidadePublica,
  type TarifasPublicas,
  type TicketPublico,
} from '@estacionamento/shared';
import { ErroApiPublica, ticketNaoEncontrado } from '../../http/erros.js';
import { publicoRepository as repo } from './publico.repository.js';
import { linhasPublicasDaRegra } from './texto.js';

const naoEncontrado = () => new ErroApiPublica(404, 'NAO_ENCONTRADO', 'Estacionamento não encontrado.');

export const publicoService = {
  async disponibilidade(slug: string): Promise<DisponibilidadePublica> {
    const site = await repo.site(slug);
    if (!site) throw naoEncontrado();
    const categorias = await repo.disponibilidade(site.id);
    const { id: _id, ...estacionamento } = site;
    const maisRecente = categorias.reduce<Date | null>(
      (m, c) => (!m || c.atualizadoEm > m ? c.atualizadoEm : m),
      null,
    );
    return {
      estacionamento,
      totalVagas: categorias.reduce((t, c) => t + c.total, 0),
      vagasLivres: categorias.reduce((t, c) => t + c.livres, 0),
      categorias: categorias.map(({ categoria, total, livres }) => ({ categoria, total, livres })),
      atualizadoEm: maisRecente?.toISOString() ?? null,
    };
  },

  async tarifas(slug: string): Promise<TarifasPublicas> {
    const site = await repo.site(slug);
    if (!site) throw naoEncontrado();
    const tarifas = await repo.tarifas(site.id);
    const { id: _id, ...estacionamento } = site;
    return {
      estacionamento,
      vigenteDesde: tarifas[0]?.vigenteDesde.toISOString() ?? null,
      tarifas: tarifas.map(({ vigenteDesde: _v, ...t }) => t),
    };
  },

  /**
   * O ticket de quem tem o link. O token vem no cabeçalho
   * `Authorization: Ticket <token>`; só o hash é procurado no banco.
   * Cada token dá acesso a UM ticket, só para leitura.
   */
  async ticket(autorizacao: string | undefined): Promise<TicketPublico> {
    const token = /^Ticket\s+(\S+)$/.exec(autorizacao ?? '')?.[1];
    if (!token || !PADRAO_TOKEN_TICKET.test(token)) throw ticketNaoEncontrado();
    const t = await repo.ticketPorToken(createHash('sha256').update(token).digest());
    if (!t) throw ticketNaoEncontrado();

    // Valor: o mesmo motor do caixa, com a tarifa gravada no ticket na entrada
    let calculo: Pick<
      TicketPublico,
      'permanenciaMin' | 'valorCentavos' | 'pagoCentavos' | 'aPagarCentavos' | 'itens' | 'proximaCobranca'
    >;
    if (t.situacao === 'ESTACIONADO') {
      const e = calcularEstadia({
        entradaEm: t.entradaEm,
        fim: t.agora,
        regra: t.regra,
        modalidade: t.modalidade,
        pagoCentavos: t.pagoCentavos,
        emAndamento: true,
      });
      calculo = {
        permanenciaMin: e.permanenciaMin,
        valorCentavos: e.valorFinalCentavos,
        pagoCentavos: e.pagoCentavos,
        aPagarCentavos: e.aPagarCentavos,
        itens: e.itens,
        proximaCobranca: e.proximaCobranca
          ? { em: e.proximaCobranca.em.toISOString(), valorCentavos: e.proximaCobranca.valorCentavos }
          : null,
      };
    } else {
      const valor = t.situacao === 'ENCERRADO' ? (t.valorFinalCentavos ?? 0) : 0;
      calculo = {
        permanenciaMin: minutosDePermanencia(t.entradaEm, t.saidaEm ?? t.agora),
        valorCentavos: valor,
        pagoCentavos: t.pagoCentavos,
        aPagarCentavos: Math.max(0, valor - t.pagoCentavos),
        itens: t.itensFinal ?? [],
        proximaCobranca: null,
      };
    }
    return {
      estacionamento: t.estacionamento,
      numero: t.numero,
      placa: t.placa,
      categoria: t.categoria,
      vaga: t.vaga,
      situacao: t.situacao,
      entradaEm: t.entradaEm.toISOString(),
      saidaEm: t.saidaEm?.toISOString() ?? null,
      ...calculo,
      tarifa: t.tarifaDescricao,
      tabelaTarifa: {
        nome: t.tarifaNome ?? 'Padrão',
        categoria: t.categoria,
        linhas:
          t.modalidade === 'DIARIA'
            ? [t.tarifaDescricao, ...linhasPublicasDaRegra(t.regra).filter((l) => l.startsWith('Tolerância'))]
            : linhasPublicasDaRegra(t.regra),
      },
      calculadoEm: t.agora.toISOString(),
      sincronizadoEm: t.sincronizadoEm.toISOString(),
      acessoExpiraEm: t.acessoExpiraEm?.toISOString() ?? null,
      politicaAcesso: { horasAposSaida: t.horasAcessoAposSaida },
    };
  },
};
