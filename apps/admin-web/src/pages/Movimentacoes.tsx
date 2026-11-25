import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { formatarCentavos, type MovimentacaoHistorico } from '@estacionamento/shared';
import { BotoesExportar } from '../components/BotoesExportar';
import { reais } from '../components/exportar';
import { Placa } from '../components/Placa';
import { ErroDaApi } from '../services/api';
import { formatarDataHora } from '../services/rotulos';
import { sessoesApi } from '../services/sessoes';
import { vagasApi } from '../services/vagas';

const SITUACOES: Record<MovimentacaoHistorico['status'], { texto: string; classe: string }> = {
  ABERTA: { texto: 'Estacionado', classe: 'pilula--ocupada' },
  ENCERRADA: { texto: 'Encerrada', classe: 'pilula--livre' },
  CANCELADA: { texto: 'Cancelada', classe: 'pilula--indisponivel' },
};

interface Filtro {
  busca: string;
  categoriaId: string;
  situacao: string;
  de: string;
  ate: string;
}
const VAZIO: Filtro = { busca: '', categoriaId: '', situacao: '', de: '', ate: '' };

/** Operação → Movimentações: últimas entradas e saídas, com filtros. */
export function Movimentacoes() {
  const navegar = useNavigate();
  const [filtro, setFiltro] = useState<Filtro>(VAZIO);
  const [aplicado, setAplicado] = useState<Filtro>(VAZIO);
  const [itens, setItens] = useState<MovimentacaoHistorico[]>([]);
  const [proxima, setProxima] = useState<string | null>(null);
  const [somenteMinhas, setSomenteMinhas] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<{ id: string; nome: string }[]>([]);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens.filter((c) => c.ativo)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let ativo = true;
    sessoesApi
      .historico({ ...aplicado, busca: aplicado.busca.trim() || undefined, limite: '50' })
      .then((r) => {
        if (!ativo) return;
        setItens(r.itens);
        setProxima(r.proximaPagina);
        setSomenteMinhas(r.somenteMinhas);
        setErro(null);
      })
      .catch(
        (e: unknown) => ativo && setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível carregar.'),
      )
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [aplicado]);

  async function carregarMais() {
    if (!proxima) return;
    setCarregando(true);
    try {
      const r = await sessoesApi.historico({ ...aplicado, antesDe: proxima, limite: '50' });
      setItens((a) => [...a, ...r.itens]);
      setProxima(r.proximaPagina);
    } catch (e) {
      setErro(e instanceof ErroDaApi ? e.message : 'Não foi possível carregar.');
    } finally {
      setCarregando(false);
    }
  }

  const aplicar = (f: Filtro) => {
    if (f.de && f.ate && f.de > f.ate) {
      setErro('A data inicial deve ser antes da final.');
      return;
    }
    setCarregando(true);
    setAplicado(f);
  };

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Movimentações</h1>
          <p className="mudo">
            Entradas e saídas registradas, da mais recente para a mais antiga
            {somenteMinhas && ' (somente as que você registrou)'}.
          </p>
        </div>
        <BotoesExportar
          nome="movimentacoes"
          desabilitado={!itens.length}
          abas={() => [
            {
              nome: 'Movimentações',
              cabecalho: [
                'Ticket',
                'Placa',
                'Tipo',
                'Vaga',
                'Entrada',
                'Saída',
                'Situação',
                'Entrada por',
                'Saída por',
                'Valor (R$)',
              ],
              linhas: itens.map((m) => [
                m.numero,
                m.placa,
                m.categoria,
                m.vaga,
                formatarDataHora(m.entradaEm),
                m.saidaEm
                  ? formatarDataHora(m.saidaEm)
                  : m.canceladoEm
                    ? formatarDataHora(m.canceladoEm)
                    : null,
                SITUACOES[m.status].texto,
                m.operadorEntrada,
                m.operadorSaida,
                reais(m.valorFinalCentavos),
              ]),
            },
          ]}
        />
      </header>

      <form
        className="filtros cartao nao-imprimir"
        onSubmit={(e) => {
          e.preventDefault();
          aplicar(filtro);
        }}
      >
        <label className="campo campo--crescer">
          <span>Placa ou nº do ticket</span>
          <input
            type="search"
            value={filtro.busca}
            maxLength={20}
            spellCheck={false}
            onChange={(e) => setFiltro({ ...filtro, busca: e.target.value.toUpperCase() })}
            placeholder="Ex.: ABC1D23"
          />
        </label>
        <label className="campo">
          <span>Tipo de veículo</span>
          <select
            value={filtro.categoriaId}
            onChange={(e) => aplicar({ ...filtro, categoriaId: e.target.value })}
          >
            <option value="">Todos</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Situação</span>
          <select value={filtro.situacao} onChange={(e) => aplicar({ ...filtro, situacao: e.target.value })}>
            <option value="">Todas</option>
            <option value="ABERTA">Estacionado</option>
            <option value="ENCERRADA">Encerrada</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
        </label>
        <label className="campo">
          <span>Entrada de</span>
          <input
            type="date"
            value={filtro.de}
            onChange={(e) => setFiltro({ ...filtro, de: e.target.value })}
          />
        </label>
        <label className="campo">
          <span>até</span>
          <input
            type="date"
            value={filtro.ate}
            onChange={(e) => setFiltro({ ...filtro, ate: e.target.value })}
          />
        </label>
        <div className="acoes">
          <button type="submit" className="botao">
            Filtrar
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => {
              setFiltro(VAZIO);
              aplicar(VAZIO);
            }}
          >
            Limpar
          </button>
        </div>
      </form>

      <section className="cartao">
        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}
        {carregando && !itens.length && <p className="mudo">Carregando…</p>}
        {!carregando && !erro && !itens.length && <p className="mudo">Nenhuma movimentação encontrada.</p>}
        {itens.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta">
              <thead>
                <tr>
                  <th scope="col">Placa</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Entrada</th>
                  <th scope="col">Saída</th>
                  <th scope="col">Vaga</th>
                  <th scope="col">Funcionário</th>
                  <th scope="col">Situação</th>
                  <th scope="col" className="numero">
                    Valor
                  </th>
                </tr>
              </thead>
              <tbody>
                {itens.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <Placa placa={m.placa} />
                      <div className="mudo pequeno">nº {m.numero}</div>
                    </td>
                    <td>{m.categoria}</td>
                    <td className="sem-quebra">{formatarDataHora(m.entradaEm)}</td>
                    <td className="sem-quebra">
                      {m.saidaEm
                        ? formatarDataHora(m.saidaEm)
                        : m.canceladoEm
                          ? formatarDataHora(m.canceladoEm)
                          : '—'}
                    </td>
                    <td>{m.vaga ?? '—'}</td>
                    <td>
                      <div>{m.operadorEntrada ?? '—'}</div>
                      {m.operadorSaida && m.operadorSaida !== m.operadorEntrada && (
                        <div className="mudo pequeno">saída: {m.operadorSaida}</div>
                      )}
                    </td>
                    <td>
                      <span className={`pilula ${SITUACOES[m.status].classe}`}>
                        {SITUACOES[m.status].texto}
                      </span>
                      {m.status === 'ABERTA' && (
                        <button
                          type="button"
                          className="botao-link nao-imprimir"
                          onClick={() => navegar(`/operacao?saida=${m.id}`)}
                        >
                          Dar saída
                        </button>
                      )}
                    </td>
                    <td className="numero">
                      {m.valorFinalCentavos === null ? '—' : formatarCentavos(m.valorFinalCentavos)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {proxima && (
          <div className="acoes nao-imprimir">
            <button
              type="button"
              className="botao botao--secundario"
              disabled={carregando}
              onClick={() => void carregarMais()}
            >
              {carregando ? 'Carregando…' : 'Carregar mais'}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
