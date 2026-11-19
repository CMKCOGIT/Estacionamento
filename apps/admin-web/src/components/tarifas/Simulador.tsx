import { useState } from 'react';
import {
  detalharTarifa,
  formatarCentavos,
  regraDeDados,
  type Modalidade,
  type RegraCadastrada,
  type TabelaTarifaDetalhe,
} from '@estacionamento/shared';

interface Props {
  vigente: TabelaTarifaDetalhe | null;
  rascunho: TabelaTarifaDetalhe | null;
}

type Coluna = { titulo: string; tabela: TabelaTarifaDetalhe };

function Resultado({
  regra,
  minutos,
  modalidade,
}: {
  regra: RegraCadastrada | undefined;
  minutos: number;
  modalidade: Modalidade;
}) {
  if (!regra) return <p className="mudo pequeno">Sem esta tarifa nesta versão.</p>;
  if (!regra.ativo) return <p className="mudo pequeno">Desativada nesta versão.</p>;
  if (modalidade === 'DIARIA' && regra.diariaCentavos === null)
    return <p className="mudo pequeno">Não oferece diária.</p>;
  const d = detalharTarifa(regraDeDados(regra), minutos, modalidade);
  return (
    <>
      <p className="simulador__total">{formatarCentavos(d.totalCentavos)}</p>
      <ul className="lista-simples pequeno">
        {d.itens.map((i) => (
          <li key={i.descricao}>
            {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
            {i.descricao}: {formatarCentavos(i.totalCentavos)}
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Quanto custa ficar X horas?" — com a versão em vigor e a em edição lado a lado. */
export function Simulador({ vigente, rascunho }: Props) {
  const colunas: Coluna[] = [
    ...(vigente ? [{ titulo: `Em vigor (v${vigente.versao})`, tabela: vigente }] : []),
    ...(rascunho ? [{ titulo: `Nova versão (v${rascunho.versao})`, tabela: rascunho }] : []),
  ];
  const todas = colunas.flatMap((c) => c.tabela.regras);
  const opcoes = [...new Map(todas.map((r) => [`${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`, r])).values()];
  const [escolha, setEscolha] = useState(() => {
    const r = opcoes[0];
    return r ? `${r.categoriaId}|${r.tipo}|${r.nome ?? ''}` : '';
  });
  const [horas, setHoras] = useState('2');
  const [minutos, setMinutos] = useState('20');
  const [modalidade, setModalidade] = useState<Modalidade>('AVULSO');

  if (!colunas.length) return null;
  const total = Math.max(0, (Number(horas) || 0) * 60 + (Number(minutos) || 0));
  const achar = (t: TabelaTarifaDetalhe) =>
    t.regras.find((r) => `${r.categoriaId}|${r.tipo}|${r.nome ?? ''}` === escolha);

  return (
    <section className="cartao" aria-labelledby="titulo-simulador">
      <h2 id="titulo-simulador">Simulador</h2>
      <p className="mudo pequeno">
        Confira quanto o cliente paga antes de publicar. O cálculo é o mesmo do caixa.
      </p>
      <div className="filtros simulador__campos">
        <label className="campo campo--crescer">
          <span>Tarifa</span>
          <select value={escolha} onChange={(e) => setEscolha(e.target.value)}>
            {opcoes.map((r) => (
              <option
                key={`${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`}
                value={`${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`}
              >
                {r.categoria} · {r.tipo === 'PADRAO' ? 'Padrão' : r.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo campo--curto">
          <span>Horas</span>
          <input
            value={horas}
            onChange={(e) => setHoras(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </label>
        <label className="campo campo--curto">
          <span>Minutos</span>
          <input
            value={minutos}
            onChange={(e) => setMinutos(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
          />
        </label>
        <label className="campo">
          <span>Cobrança</span>
          <select value={modalidade} onChange={(e) => setModalidade(e.target.value as Modalidade)}>
            <option value="AVULSO">Por tempo</option>
            <option value="DIARIA">Diária</option>
          </select>
        </label>
      </div>
      <div className="simulador__colunas">
        {colunas.map((c) => (
          <div key={c.titulo} className="simulador__coluna">
            <h3 className="pequeno mudo">{c.titulo}</h3>
            <Resultado regra={achar(c.tabela)} minutos={total} modalidade={modalidade} />
          </div>
        ))}
      </div>
    </section>
  );
}
