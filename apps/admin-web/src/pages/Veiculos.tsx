import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  formatarCentavos,
  formatarPlaca,
  normalizarPlaca,
  type Categoria,
  type ListaVeiculos,
  type VeiculoResumo,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Placa } from '../components/Placa';
import { DialogoVeiculo } from '../components/veiculos/DialogoVeiculo';
import { duracaoCurta } from '../components/vagas/MapaVagas';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { ErroDaApi } from '../services/api';
import { formatarDataHora } from '../services/rotulos';
import { vagasApi } from '../services/vagas';
import { veiculosApi } from '../services/veiculos';

export function Veiculos() {
  const { temPermissao } = useAuth();
  const navegar = useNavigate();
  const podeGerenciar = temPermissao('veiculo.gerenciar');

  const [consulta, setConsulta] = useState('');
  const [resultadoConsulta, setResultadoConsulta] = useState<{
    tipo: 'info' | 'erro';
    texto: string;
    placa?: string;
  } | null>(null);
  const [consultando, setConsultando] = useState(false);

  const [aba, setAba] = useState<'estacionados' | 'todos'>('estacionados');
  const [busca, setBusca] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [mais, setMais] = useState<VeiculoResumo[]>([]);
  const [paginaExtra, setPaginaExtra] = useState<number | null>(null);
  const [novo, setNovo] = useState<string | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens))
      .catch(() => undefined);
  }, []);

  const carregar = useCallback(
    () => veiculosApi.listar({ busca: busca.trim(), categoriaId, estacionados: aba === 'estacionados' }),
    [busca, categoriaId, aba],
  );
  const lista = useAtualizacaoAutomatica<ListaVeiculos>(carregar, 15_000);
  const itens = [...(lista.dados?.itens ?? []), ...mais];
  const proxima = mais.length ? paginaExtra : (lista.dados?.proximaPagina ?? null);

  const mudarFiltro = (f: () => void) => {
    setMais([]);
    setPaginaExtra(null);
    f();
  };

  async function consultar(e: FormEvent) {
    e.preventDefault();
    const placa = normalizarPlaca(consulta);
    if (!placa) return;
    setConsultando(true);
    setResultadoConsulta(null);
    try {
      const r = await veiculosApi.consultarPlaca(placa);
      if (r.veiculo) navegar(`/veiculos/${r.veiculo.id}`);
      else if (!r.valida)
        setResultadoConsulta({
          tipo: 'erro',
          texto: `"${consulta}" não é uma placa válida (ABC1234 ou ABC1D23).`,
        });
      else
        setResultadoConsulta({
          tipo: 'info',
          texto: `A placa ${formatarPlaca(r.placa)} ainda não está cadastrada.`,
          placa: r.placa,
        });
    } catch (falha) {
      setResultadoConsulta({
        tipo: 'erro',
        texto: falha instanceof ErroDaApi ? falha.message : 'Erro na consulta',
      });
    } finally {
      setConsultando(false);
    }
  }

  async function carregarMais() {
    if (!proxima) return;
    const r = await veiculosApi.listar({
      busca: busca.trim(),
      categoriaId,
      estacionados: aba === 'estacionados',
      pagina: proxima,
    });
    setMais((m) => [...m, ...r.itens]);
    setPaginaExtra(r.proximaPagina);
  }

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Veículos</h1>
          <p className="mudo">Cadastro, consulta por placa e histórico de estadias.</p>
        </div>
        {podeGerenciar && (
          <button type="button" className="botao" onClick={() => setNovo('')}>
            Novo veículo
          </button>
        )}
      </header>

      <form className="cartao consulta-placa" onSubmit={consultar}>
        <label className="campo campo--crescer">
          <span>Consultar placa</span>
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value.toUpperCase())}
            placeholder="ABC1D23"
            maxLength={12}
            autoCapitalize="characters"
            spellCheck={false}
            className="entrada-placa"
            aria-describedby="resultado-consulta"
          />
        </label>
        <button type="submit" className="botao" disabled={consultando || !consulta.trim()}>
          {consultando ? 'Consultando…' : 'Consultar'}
        </button>
        {resultadoConsulta && (
          <p
            id="resultado-consulta"
            className={`alerta alerta--${resultadoConsulta.tipo} consulta-placa__resultado`}
            role="status"
          >
            {resultadoConsulta.texto}{' '}
            {resultadoConsulta.placa && podeGerenciar && (
              <button
                type="button"
                className="botao-texto"
                onClick={() => setNovo(resultadoConsulta.placa ?? '')}
              >
                Cadastrar agora
              </button>
            )}
          </p>
        )}
      </form>

      <div className="abas abas--pagina" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'estacionados'}
          className={aba === 'estacionados' ? 'aba aba--ativa' : 'aba'}
          onClick={() => mudarFiltro(() => setAba('estacionados'))}
        >
          Estacionados agora{lista.dados && ` (${lista.dados.estacionadosAgora})`}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={aba === 'todos'}
          className={aba === 'todos' ? 'aba aba--ativa' : 'aba'}
          onClick={() => mudarFiltro(() => setAba('todos'))}
        >
          Todos os veículos
        </button>
      </div>

      <div className="filtros cartao">
        <label className="campo campo--crescer">
          <span>Filtrar</span>
          <input
            type="search"
            value={busca}
            onChange={(e) => mudarFiltro(() => setBusca(e.target.value))}
            placeholder="Parte da placa, marca, modelo ou cor"
            maxLength={40}
          />
        </label>
        <label className="campo">
          <span>Categoria</span>
          <select value={categoriaId} onChange={(e) => mudarFiltro(() => setCategoriaId(e.target.value))}>
            <option value="">Todas</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="cartao">
        {!lista.dados && <p className="mudo">Carregando…</p>}
        {lista.erro && <p className="alerta alerta--erro">{lista.erro.message}</p>}
        {lista.dados && itens.length === 0 && (
          <p className="mudo">
            {aba === 'estacionados' ? 'Nenhum veículo estacionado agora.' : 'Nenhum veículo encontrado.'}
          </p>
        )}
        {itens.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Placa</th>
                  <th>Veículo</th>
                  <th>Categoria</th>
                  <th>Situação</th>
                  <th className="numero">Estadias</th>
                  <th>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/veiculos/${v.id}`} aria-label={`Abrir ${formatarPlaca(v.placa)}`}>
                        <Placa placa={v.placa} estrangeira={v.placaEstrangeira} />
                      </Link>
                    </td>
                    <td>
                      {[v.marca, v.modelo, v.cor].filter(Boolean).join(' · ') || (
                        <span className="mudo">—</span>
                      )}
                    </td>
                    <td>{v.categoria}</td>
                    <td>
                      {v.estadiaAtual ? (
                        <span className="situacao-veiculo situacao-veiculo--dentro">
                          <span aria-hidden="true">●</span> Estacionado
                          {v.estadiaAtual.vaga && ` · vaga ${v.estadiaAtual.vaga}`} · há{' '}
                          {duracaoCurta(v.estadiaAtual.permanenciaMin)}
                          {v.estadiaAtual.valorEstimadoCentavos > 0 && (
                            <span className="mudo">
                              {' '}
                              · {formatarCentavos(v.estadiaAtual.valorEstimadoCentavos)} em aberto
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="mudo">Fora do estacionamento</span>
                      )}
                    </td>
                    <td className="numero">{v.totalEstadias}</td>
                    <td className="sem-quebra">{formatarDataHora(v.ultimaVisitaEm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {proxima && (
          <div className="acoes">
            <button type="button" className="botao botao--secundario" onClick={() => void carregarMais()}>
              Carregar mais
            </button>
          </div>
        )}
      </section>

      {novo !== null && (
        <DialogoVeiculo
          aberto
          veiculo={null}
          placaInicial={novo}
          categorias={categorias}
          onFechar={() => setNovo(null)}
          onSalvo={(v) => navegar(`/veiculos/${v.id}`)}
        />
      )}
    </>
  );
}
