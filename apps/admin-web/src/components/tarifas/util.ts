import {
  descreverCondicao,
  formatarCentavos,
  type RegraCadastrada,
  type SituacaoTabela,
  type TabelaTarifaDetalhe,
} from '@estacionamento/shared';

export const ROTULO_SITUACAO: Record<SituacaoTabela, string> = {
  RASCUNHO: 'Em edição',
  VIGENTE: 'Em vigor',
  AGENDADA: 'Agendada',
  SUBSTITUIDA: 'Substituída',
  ARQUIVADA: 'Arquivada',
};

export const CLASSE_SITUACAO: Record<SituacaoTabela, string> = {
  RASCUNHO: 'etiqueta--sem_acesso',
  VIGENTE: 'etiqueta--ativo',
  AGENDADA: 'etiqueta--bloqueado',
  SUBSTITUIDA: 'etiqueta--inativo',
  ARQUIVADA: 'etiqueta--inativo',
};

const dinheiro = (v: number | null) => (v === null ? '—' : formatarCentavos(v));

/** Linhas "rótulo: valor" de uma regra, na linguagem do balcão. */
export function linhasDaRegra(r: RegraCadastrada): [string, string][] {
  const l: [string, string][] = [];
  if (r.valorFixoCentavos !== null) {
    l.push(['Preço fixo', `${formatarCentavos(r.valorFixoCentavos)} a cada 24h`]);
  } else {
    l.push(['1ª hora', formatarCentavos(r.primeiraHoraCentavos)]);
    l.push(['Hora adicional', formatarCentavos(r.horaAdicionalCentavos)]);
    l.push([
      'Depois da 1ª hora',
      r.fracaoMin && r.fracaoCentavos !== null
        ? `fração de ${r.fracaoMin} min por ${formatarCentavos(r.fracaoCentavos)}`
        : 'cobra por hora cheia',
    ]);
    l.push([
      'Arredondamento',
      r.carenciaMin
        ? `carência de ${r.carenciaMin} min em cada período`
        : 'para cima (minuto iniciado conta)',
    ]);
    l.push([
      'Diária máxima',
      r.diariaMaximaCentavos === null ? 'sem limite' : formatarCentavos(r.diariaMaximaCentavos),
    ]);
  }
  l.push(['Diária (modo diária)', r.diariaCentavos === null ? 'não oferece' : dinheiro(r.diariaCentavos)]);
  l.push(['Tolerância', r.toleranciaMin ? `${r.toleranciaMin} min sem cobrança` : 'sem tolerância']);
  return l;
}

export function quandoVale(r: RegraCadastrada): string {
  if (r.tipo === 'PADRAO') return 'Sempre que nenhuma especial se aplicar';
  return r.aplicacao === 'MANUAL'
    ? 'Escolhida pelo operador na entrada'
    : `Automática — ${descreverCondicao(r)}`;
}

const chave = (r: RegraCadastrada) => `${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`;
const titulo = (r: RegraCadastrada) => `${r.categoria} · ${r.tipo === 'PADRAO' ? 'padrão' : r.nome}`;

/** O que muda do que está em vigor para o rascunho (mostrado antes de publicar). */
export function diferencas(atual: TabelaTarifaDetalhe | null, nova: TabelaTarifaDetalhe): string[] {
  const antes = new Map((atual?.regras ?? []).map((r) => [chave(r), r]));
  const saida: string[] = [];
  for (const r of nova.regras) {
    const a = antes.get(chave(r));
    antes.delete(chave(r));
    if (!a) {
      saida.push(`${titulo(r)}: nova${r.ativo ? '' : ' (desativada)'}`);
      continue;
    }
    if (a.ativo !== r.ativo) saida.push(`${titulo(r)}: ${r.ativo ? 'reativada' : 'desativada'}`);
    const la = new Map(linhasDaRegra(a));
    for (const [rotulo, valor] of linhasDaRegra(r)) {
      const v = la.get(rotulo);
      if (v !== undefined && v !== valor) saida.push(`${titulo(r)}: ${rotulo.toLowerCase()} ${v} → ${valor}`);
      else if (v === undefined) saida.push(`${titulo(r)}: ${rotulo.toLowerCase()} ${valor}`);
    }
    if (quandoVale(a) !== quandoVale(r)) saida.push(`${titulo(r)}: ${quandoVale(r).toLowerCase()}`);
  }
  for (const r of antes.values()) saida.push(`${titulo(r)}: removida`);
  return saida;
}
