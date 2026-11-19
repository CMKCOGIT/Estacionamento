import type { RowDataPacket } from 'mysql2/promise';
import { especialSeAplica } from '@estacionamento/calculo';
import {
  descreverCondicao,
  descreverRegra,
  type Modalidade,
  type OpcaoTarifaEntrada,
  type TarifaAplicada,
  type TarifasDaEntrada,
} from '@estacionamento/shared';
import { env } from '../../config/env.js';
import type { Conexao } from '../../db/pool.js';
import type { pool } from '../../db/pool.js';
import { erros } from '../../http/erros.js';
import { regraCadastrada, tarifasRepository as repo } from './tarifas.repository.js';
import { regraDaLinha } from './regra.js';

/** Dia da semana (0 = domingo) e minuto do dia no fuso do estacionamento. */
export function momentoLocal(d: Date): { diaSemana: number; minutoDoDia: number } {
  const [, sinal, h, m] = /^([+-])(\d{2}):(\d{2})$/.exec(env.FUSO_OFFSET)!;
  const offset = (sinal === '-' ? -1 : 1) * (Number(h) * 60 + Number(m));
  const local = new Date(d.getTime() + offset * 60_000);
  return { diaSemana: local.getUTCDay(), minutoDoDia: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

const condicaoDe = (l: RowDataPacket) => {
  const r = regraCadastrada(l);
  return { diasSemana: r.diasSemana, horaInicio: r.horaInicio, horaFim: r.horaFim };
};

function automaticaAgora(linhas: RowDataPacket[]): RowDataPacket | undefined {
  if (!linhas.length) return undefined;
  const { diaSemana, minutoDoDia } = momentoLocal(linhas[0]!.agora as Date);
  return linhas.find(
    (l) =>
      l.tipo === 'ESPECIAL' &&
      l.aplicacao === 'AUTOMATICA' &&
      especialSeAplica(condicaoDe(l), diaSemana, minutoDoDia),
  );
}

/** Opções mostradas ao operador na entrada. */
export async function tarifasDaEntrada(
  c: Conexao | typeof pool,
  siteId: string,
  categoriaId: string,
): Promise<TarifasDaEntrada> {
  const linhas = await repo.regrasVigentes(c, siteId, categoriaId);
  const padrao = linhas.find((l) => l.tipo === 'PADRAO');
  if (!padrao) return { tabela: null, opcoes: [], automaticaId: null };
  const opcoes: OpcaoTarifaEntrada[] = linhas.map((l) => ({
    id: l.id,
    tipo: l.tipo,
    nome: l.tipo === 'PADRAO' ? 'Padrão' : String(l.nome),
    aplicacao: l.aplicacao ?? null,
    descricao: descreverRegra(regraDaLinha(l)),
    condicao: l.tipo === 'ESPECIAL' && l.aplicacao === 'AUTOMATICA' ? descreverCondicao(condicaoDe(l)) : null,
    temDiaria: l.diaria_centavos !== null,
  }));
  return {
    tabela: { id: padrao.tabela_id, versao: Number(padrao.tabela_versao), nome: padrao.tabela_nome },
    opcoes,
    automaticaId: (automaticaAgora(linhas) ?? padrao).id,
  };
}

/**
 * Escolhe a regra do ticket e monta a cópia que fica gravada nele:
 * 1. a especial escolhida pelo operador; senão
 * 2. a especial automática do dia/horário (só no modo avulso); senão
 * 3. a padrão da categoria.
 */
export async function escolherTarifa(
  c: Conexao,
  o: {
    siteId: string;
    categoriaId: string;
    categoriaNome: string;
    modalidade: Modalidade;
    regraId?: string | null;
  },
): Promise<{ regraId: string; aplicada: TarifaAplicada }> {
  const linhas = await repo.regrasVigentes(c, o.siteId, o.categoriaId);
  const padrao = linhas.find((l) => l.tipo === 'PADRAO');
  if (!padrao) {
    throw erros.regraDeNegocio(
      `Não há tabela de tarifas publicada com preço para ${o.categoriaNome}. Publique uma tabela de tarifas antes de registrar entradas.`,
    );
  }

  let escolhida: RowDataPacket;
  let selecao: TarifaAplicada['selecao'];
  if (o.regraId) {
    const l = linhas.find((x) => x.id === o.regraId);
    if (!l) {
      throw erros.regraDeNegocio(
        `A tarifa escolhida não está disponível para ${o.categoriaNome} na tabela vigente. Atualize a tela e escolha de novo.`,
      );
    }
    escolhida = l;
    selecao = l.tipo === 'PADRAO' ? 'PADRAO' : 'ESPECIAL_MANUAL';
  } else {
    const auto = o.modalidade === 'AVULSO' ? automaticaAgora(linhas) : undefined;
    escolhida = auto ?? padrao;
    selecao = auto ? 'ESPECIAL_AUTOMATICA' : 'PADRAO';
  }

  const regra = regraDaLinha(escolhida);
  const nome = escolhida.tipo === 'PADRAO' ? 'Padrão' : String(escolhida.nome);
  if (o.modalidade === 'DIARIA' && regra.diariaCentavos === null) {
    throw erros.regraDeNegocio(`A tarifa ${nome} de ${o.categoriaNome} não tem modalidade diária.`);
  }
  return {
    regraId: escolhida.id,
    aplicada: {
      tabelaId: escolhida.tabela_id,
      tabelaVersao: Number(escolhida.tabela_versao),
      tabelaNome: escolhida.tabela_nome,
      vigenteDesde: (escolhida.vigente_desde as Date).toISOString(),
      regraId: escolhida.id,
      tipo: escolhida.tipo,
      nome,
      categoria: o.categoriaNome,
      selecao,
      regra,
    },
  };
}
