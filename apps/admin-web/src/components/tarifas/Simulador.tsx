import { useEffect, useState } from 'react';
import {
  formatarCentavos,
  type Modalidade,
  type RegraCadastrada,
  type ResultadoSimulacao,
  type TabelaTarifaDetalhe,
} from '@estacionamento/shared';
import { tarifasApi } from '../../services/tarifas';

interface Props {
  vigente: TabelaTarifaDetalhe | null;
  rascunho: TabelaTarifaDetalhe | null;
}

type Coluna = { titulo: string; tabela: TabelaTarifaDetalhe };
type Resultado = ResultadoSimulacao['resultados'][number];

const chaveDe = (r: RegraCadastrada) => `${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`;

function Resultado({
  regra,
  resultado,
  modalidade,
}: {
  regra: RegraCadastrada | undefined;
  resultado: Resultado | undefined;
  modalidade: Modalidade;
}) {
  if (!regra) return <p className="mudo pequeno">Sem esta tarifa nesta versão.</p>;
  if (!regra.ativo) return <p className="mudo pequeno">Desativada nesta versão.</p>;
  if (!resultado) return <p className="mudo pequeno">Calculando…</p>;
  if (resultado.totalCentavos === null)
    return <p className="mudo pequeno">{modalidade === 'DIARIA' ? 'Não oferece diária.' : '—'}</p>;
  return (
    <>
      <p className="simulador__total">{formatarCentavos(resultado.totalCentavos)}</p>
      <ul className="lista-simples pequeno">
        {resultado.itens.map((i) => (
          <li key={i.descricao}>
            {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
            {i.descricao}: {formatarCentavos(i.totalCentavos)}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * "Quanto custa ficar X horas?" — com a versão em vigor e a em edição lado a
 * lado. O cálculo é feito pelo servidor, com a mesma função do caixa.
 */
export function Simulador({ vigente, rascunho }: Props) {
  const colunas: Coluna[] = [
    ...(vigente ? [{ titulo: `Em vigor (v${vigente.versao})`, tabela: vigente }] : []),
    ...(rascunho ? [{ titulo: `Nova versão (v${rascunho.versao})`, tabela: rascunho }] : []),
  ];
  const todas = colunas.flatMap((c) => c.tabela.regras);
  const opcoes = [...new Map(todas.map((r) => [chaveDe(r), r])).values()];
  const [escolha, setEscolha] = useState(() => (opcoes[0] ? chaveDe(opcoes[0]) : ''));
  const [horas, setHoras] = useState('2');
  const [minutos, setMinutos] = useState('20');
  const [modalidade, setModalidade] = useState<Modalidade>('AVULSO');
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const total = Math.max(0, (Number(horas) || 0) * 60 + (Number(minutos) || 0));
  const achar = (t: TabelaTarifaDetalhe) => t.regras.find((r) => chaveDe(r) === escolha);
  const ids = colunas
    .map((c) => achar(c.tabela))
    .filter((r): r is RegraCadastrada => !!r && r.ativo)
    .map((r) => r.id)
    .join(',');

  useEffect(() => {
    if (!ids) return;
    let ativo = true;
    const t = setTimeout(() => {
      tarifasApi
        .simular({ regraIds: ids.split(','), duracoes: [total], modalidade })
        .then((r) => {
          if (!ativo) return;
          setResultados(r.resultados);
          setErro(null);
        })
        .catch((e: Error) => ativo && setErro(e.message));
    }, 200);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [ids, total, modalidade]);

  if (!colunas.length) return null;
  return (
    <section className="cartao" aria-labelledby="titulo-simulador">
      <h2 id="titulo-simulador">Simulador</h2>
      <p className="mudo pequeno">
        Confira quanto o cliente paga antes de publicar. O cálculo é feito pelo servidor, igual ao do caixa.
      </p>
      <div className="filtros simulador__campos">
        <label className="campo campo--crescer">
          <span>Tarifa</span>
          <select value={escolha} onChange={(e) => setEscolha(e.target.value)}>
            {opcoes.map((r) => (
              <option key={chaveDe(r)} value={chaveDe(r)}>
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
            maxLength={4}
          />
        </label>
        <label className="campo campo--curto">
          <span>Minutos</span>
          <input
            value={minutos}
            onChange={(e) => setMinutos(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric"
            maxLength={4}
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
      {erro && <p className="alerta alerta--erro">{erro}</p>}
      <div className="simulador__colunas">
        {colunas.map((c) => {
          const regra = achar(c.tabela);
          return (
            <div key={c.titulo} className="simulador__coluna">
              <h3 className="pequeno mudo">{c.titulo}</h3>
              <Resultado
                regra={regra}
                resultado={resultados.find((x) => x.regraId === regra?.id)}
                modalidade={modalidade}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
