import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { formatarCentavos, type Categoria, type Estadia } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Placa } from '../components/Placa';
import { DialogoMotivo } from '../components/vagas/Dialogos';
import { duracaoCurta } from '../components/vagas/MapaVagas';
import { DialogoVeiculo } from '../components/veiculos/DialogoVeiculo';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { formatarDataHora } from '../services/rotulos';
import { vagasApi } from '../services/vagas';
import { veiculosApi } from '../services/veiculos';

const ROTULO_STATUS: Record<Estadia['status'], string> = {
  ABERTA: 'Estacionado',
  ENCERRADA: 'Encerrada',
  CANCELADA: 'Cancelada',
};

export function VeiculoDetalhe() {
  const { id = '' } = useParams();
  const navegar = useNavigate();
  const { temPermissao } = useAuth();
  const podeGerenciar = temPermissao('veiculo.gerenciar');
  const carregar = useCallback(() => veiculosApi.obter(id), [id]);
  const v = useAtualizacaoAutomatica(carregar, 30_000);

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [dialogo, setDialogo] = useState<'editar' | 'remover' | null>(null);
  const [mensagem, setMensagem] = useState<string | null>(null);

  const [estadias, setEstadias] = useState<Estadia[]>([]);
  const [proxima, setProxima] = useState<string | null>(null);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    let ativo = true;
    veiculosApi
      .estadias(id)
      .then((p) => {
        if (!ativo) return;
        setEstadias(p.itens);
        setProxima(p.proximaPagina);
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [id, versao, v.dados?.estadiaAtual?.sessaoId]);

  const carregarMais = async () => {
    if (!proxima) return;
    const p = await veiculosApi.estadias(id, Number(proxima));
    setEstadias((e) => [...e, ...p.itens]);
    setProxima(p.proximaPagina);
  };

  if (!v.dados)
    return v.erro ? (
      <p className="alerta alerta--erro">{v.erro.message}</p>
    ) : (
      <p className="mudo">Carregando…</p>
    );
  const veiculo = v.dados;
  const e = veiculo.estatisticas;
  const atual = veiculo.estadiaAtual;

  return (
    <>
      <header className="cabecalho">
        <div>
          <Link to="/veiculos" className="botao-texto">
            ← Veículos
          </Link>
          <h1 className="titulo-veiculo">
            <Placa placa={veiculo.placa} grande estrangeira={veiculo.placaEstrangeira} />
            <span>{[veiculo.marca, veiculo.modelo].filter(Boolean).join(' ') || 'Veículo'}</span>
          </h1>
          <p className="mudo">
            {veiculo.categoria}
            {veiculo.cor && ` · ${veiculo.cor}`}
            {veiculo.observacoes && ` · ${veiculo.observacoes}`}
          </p>
        </div>
        {podeGerenciar && (
          <div className="acoes">
            <button type="button" className="botao botao--secundario" onClick={() => setDialogo('editar')}>
              Editar
            </button>
            {veiculo.totalEstadias === 0 && (
              <button type="button" className="botao botao--perigo" onClick={() => setDialogo('remover')}>
                Excluir
              </button>
            )}
          </div>
        )}
      </header>

      {mensagem && (
        <p className="alerta alerta--ok" role="status">
          {mensagem}
        </p>
      )}

      <section className={`cartao estadia-atual${atual ? ' estadia-atual--dentro' : ''}`}>
        {atual ? (
          <>
            <h2>
              <span aria-hidden="true">●</span> Estacionado agora
            </h2>
            <dl className="resumo">
              <div>
                <dt>Vaga</dt>
                <dd>{atual.vaga ?? '—'}</dd>
              </div>
              <div>
                <dt>Entrada</dt>
                <dd>{formatarDataHora(atual.entradaEm)}</dd>
              </div>
              <div>
                <dt>Permanência</dt>
                <dd>{duracaoCurta(atual.permanenciaMin)}</dd>
              </div>
              <div>
                <dt>Em aberto (estimado)</dt>
                <dd>{formatarCentavos(atual.valorEstimadoCentavos)}</dd>
              </div>
            </dl>
            <p className="mudo pequeno">
              Ticket nº {atual.numero} · {atual.modalidade === 'DIARIA' ? 'diária' : 'avulso'}
              {atual.pagoCentavos > 0 && ` · ${formatarCentavos(atual.pagoCentavos)} já pagos`}
            </p>
          </>
        ) : (
          <p className="mudo">
            Fora do estacionamento
            {veiculo.ultimaVisitaEm && ` · última visita em ${formatarDataHora(veiculo.ultimaVisitaEm)}`}.
          </p>
        )}
      </section>

      <section className="indicadores" aria-label="Resumo das estadias">
        <article className="indicador-cartao">
          <span className="indicador-cartao__rotulo">Estadias</span>
          <span className="indicador-cartao__valor">{e.totalEstadias}</span>
          {e.canceladas > 0 && <span className="indicador-cartao__extra">{e.canceladas} cancelada(s)</span>}
        </article>
        <article className="indicador-cartao">
          <span className="indicador-cartao__rotulo">Tempo médio</span>
          <span className="indicador-cartao__valor">
            {e.tempoMedioMin === null ? '—' : duracaoCurta(e.tempoMedioMin)}
          </span>
        </article>
        <article className="indicador-cartao">
          <span className="indicador-cartao__rotulo">Tempo total</span>
          <span className="indicador-cartao__valor">{duracaoCurta(e.tempoTotalMin)}</span>
        </article>
        <article className="indicador-cartao">
          <span className="indicador-cartao__rotulo">Total pago</span>
          <span className="indicador-cartao__valor">{formatarCentavos(e.totalPagoCentavos)}</span>
        </article>
        <article className="indicador-cartao">
          <span className="indicador-cartao__rotulo">Cliente desde</span>
          <span className="indicador-cartao__valor indicador-cartao__valor--texto">
            {e.primeiraVisitaEm ? new Date(e.primeiraVisitaEm).toLocaleDateString('pt-BR') : '—'}
          </span>
        </article>
      </section>

      <section className="cartao">
        <h2>Histórico de estadias</h2>
        {estadias.length === 0 ? (
          <p className="mudo">Este veículo ainda não estacionou aqui.</p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela">
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Entrada</th>
                  <th>Saída</th>
                  <th>Permanência</th>
                  <th>Vaga</th>
                  <th className="numero">Valor</th>
                  <th>Situação</th>
                  <th>Atendido por</th>
                </tr>
              </thead>
              <tbody>
                {estadias.map((s) => (
                  <tr key={s.sessaoId} className={s.status === 'CANCELADA' ? 'linha-cancelada' : undefined}>
                    <td className="sem-quebra">
                      nº {s.numero}
                      {s.placa !== veiculo.placa && (
                        <div className="mudo pequeno">placa na época: {s.placa}</div>
                      )}
                    </td>
                    <td className="sem-quebra">{formatarDataHora(s.entradaEm)}</td>
                    <td className="sem-quebra">{s.saidaEm ? formatarDataHora(s.saidaEm) : '—'}</td>
                    <td className="sem-quebra">{duracaoCurta(s.permanenciaMin)}</td>
                    <td>{s.vaga ?? '—'}</td>
                    <td className="numero">
                      {s.valorFinalCentavos !== null
                        ? formatarCentavos(s.valorFinalCentavos)
                        : s.pagoCentavos > 0
                          ? `${formatarCentavos(s.pagoCentavos)} pagos`
                          : '—'}
                    </td>
                    <td>
                      <span className={`etiqueta etiqueta--estadia-${s.status.toLowerCase()}`}>
                        {ROTULO_STATUS[s.status]}
                      </span>
                      {s.motivoCancelamento && <div className="mudo pequeno">{s.motivoCancelamento}</div>}
                    </td>
                    <td>
                      {s.operadorEntrada ?? '—'}
                      {s.operadorSaida && s.operadorSaida !== s.operadorEntrada && (
                        <span className="mudo"> / {s.operadorSaida}</span>
                      )}
                    </td>
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

      {dialogo === 'editar' && (
        <DialogoVeiculo
          aberto
          veiculo={veiculo}
          categorias={categorias}
          onFechar={() => setDialogo(null)}
          onSalvo={() => {
            setDialogo(null);
            setMensagem('Veículo atualizado.');
            v.atualizarAgora();
            setVersao((x) => x + 1);
          }}
        />
      )}
      {dialogo === 'remover' && (
        <DialogoMotivo
          aberto
          perigo
          titulo={`Excluir o veículo ${veiculo.placa}?`}
          texto="Este veículo nunca estacionou aqui, por isso pode ser excluído. Veículos com estadias não podem ser excluídos."
          textoConfirmar="Excluir"
          onFechar={() => setDialogo(null)}
          acao={async (motivo) => (await veiculosApi.remover(veiculo.id, motivo), 'ok')}
          onConcluir={() => navegar('/veiculos', { replace: true })}
        />
      )}
    </>
  );
}
