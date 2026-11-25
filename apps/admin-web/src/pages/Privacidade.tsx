import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  formatarCentavos,
  TIPOS_SOLICITACAO_LGPD,
  type EncarregadoDados,
  type PoliticaRetencao,
  type RelatorioTitular,
  type ResultadoRetencao,
  type SolicitacaoLgpd,
  type TipoSolicitacaoLgpd,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { ErroDaApi } from '../services/api';
import { Incidentes, Inventario } from '../components/privacidade/Incidentes';
import { privacidadeApi } from '../services/privacidade';

type Aba = 'solicitacoes' | 'titular' | 'politica' | 'incidentes' | 'dados';
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '—');
const STATUS: Record<SolicitacaoLgpd['status'], string> = {
  ABERTA: 'Aberta',
  EM_ANDAMENTO: 'Em andamento',
  ATENDIDA: 'Atendida',
  INDEFERIDA: 'Indeferida',
};
const mensagemDe = (e: unknown) =>
  e instanceof ErroDaApi && Array.isArray(e.corpo.detalhes)
    ? e.corpo.detalhes.map((d) => d.mensagem).join('. ')
    : e instanceof Error
      ? e.message
      : 'Não foi possível concluir.';

/** LGPD: solicitações dos titulares, relatório/portabilidade/anonimização e política de retenção. */
export function Privacidade() {
  const [aba, setAba] = useState<Aba>('solicitacoes');
  const [placaTitular, setPlacaTitular] = useState('');
  const abas: [Aba, string][] = [
    ['solicitacoes', 'Solicitações dos titulares'],
    ['titular', 'Dados de um titular'],
    ['politica', 'Retenção e encarregado'],
    ['incidentes', 'Incidentes de segurança'],
    ['dados', 'Dados armazenados e política'],
  ];
  return (
    <section className="cartao">
      <h1>Privacidade e LGPD</h1>
      <p className="mudo">
        Atendimento aos direitos dos titulares (art. 18). Toda consulta, exportação e anonimização fica
        registrada no histórico de atividades.
      </p>
      <div className="abas abas--pagina" role="tablist">
        {abas.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? 'aba aba--ativa' : 'aba'}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'solicitacoes' && (
        <Solicitacoes
          abrirTitular={(p) => {
            setPlacaTitular(p);
            setAba('titular');
          }}
        />
      )}
      {aba === 'titular' && <Titular placaInicial={placaTitular} />}
      {aba === 'politica' && <Politica />}
      {aba === 'incidentes' && <Incidentes />}
      {aba === 'dados' && <Inventario />}
    </section>
  );
}

function Solicitacoes({ abrirTitular }: { abrirTitular: (placa: string) => void }) {
  const [itens, setItens] = useState<SolicitacaoLgpd[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [nova, setNova] = useState({
    tipo: 'CONFIRMACAO_ACESSO' as TipoSolicitacaoLgpd,
    nome: '',
    contato: '',
    placa: '',
    descricao: '',
  });
  const [respostas, setRespostas] = useState<Record<string, string>>({});

  const carregar = useCallback(
    () =>
      privacidadeApi.solicitacoes().then(
        (r) => setItens(r.itens),
        (e: unknown) => setErro(mensagemDe(e)),
      ),
    [],
  );
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function registrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    try {
      await privacidadeApi.registrar({
        tipo: nova.tipo,
        titularNome: nova.nome || null,
        titularContato: nova.contato || null,
        placa: nova.placa || null,
        descricao: nova.descricao || null,
      });
      setNova({ ...nova, nome: '', contato: '', placa: '', descricao: '' });
      await carregar();
    } catch (falha) {
      setErro(mensagemDe(falha));
    }
  }
  async function mudar(s: SolicitacaoLgpd, status: SolicitacaoLgpd['status']) {
    setErro(null);
    try {
      await privacidadeApi.atualizar(s.id, { status, resposta: respostas[s.id] || null });
      await carregar();
    } catch (falha) {
      setErro(mensagemDe(falha));
    }
  }

  return (
    <div>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      <form className="formulario-lgpd" onSubmit={registrar}>
        <h2>Registrar solicitação</h2>
        <label className="campo">
          <span>Tipo</span>
          <select
            value={nova.tipo}
            onChange={(e) => setNova({ ...nova, tipo: e.target.value as TipoSolicitacaoLgpd })}
          >
            {Object.entries(TIPOS_SOLICITACAO_LGPD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <div className="grade-2">
          <label className="campo">
            <span>Nome do titular (opcional)</span>
            <input
              value={nova.nome}
              maxLength={120}
              onChange={(e) => setNova({ ...nova, nome: e.target.value })}
            />
          </label>
          <label className="campo">
            <span>Contato para a resposta</span>
            <input
              value={nova.contato}
              maxLength={160}
              onChange={(e) => setNova({ ...nova, contato: e.target.value })}
            />
          </label>
          <label className="campo">
            <span>Placa</span>
            <input
              value={nova.placa}
              maxLength={10}
              onChange={(e) => setNova({ ...nova, placa: e.target.value.toUpperCase() })}
            />
          </label>
          <label className="campo">
            <span>Descrição do pedido</span>
            <input
              value={nova.descricao}
              maxLength={1000}
              onChange={(e) => setNova({ ...nova, descricao: e.target.value })}
            />
          </label>
        </div>
        <small className="mudo">
          Antes de entregar dados, confirme que quem pede é o titular (ex.: documento do veículo). Prazo de
          resposta: 15 dias.
        </small>
        <div className="acoes">
          <button type="submit" className="botao">
            Registrar
          </button>
        </div>
      </form>

      <h2>Solicitações</h2>
      {itens && itens.length === 0 && <p className="mudo">Nenhuma solicitação registrada.</p>}
      {itens && itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Protocolo</th>
                <th>Tipo</th>
                <th>Titular</th>
                <th>Recebida</th>
                <th>Prazo</th>
                <th>Situação</th>
                <th>Atender</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((s) => {
                const concluida = s.status === 'ATENDIDA' || s.status === 'INDEFERIDA';
                return (
                  <tr key={s.id}>
                    <td>{s.protocolo}</td>
                    <td>{TIPOS_SOLICITACAO_LGPD[s.tipo].replace(/ \(.*\)$/, '')}</td>
                    <td>
                      {s.titularNome ?? '—'}
                      {s.identificador && (
                        <>
                          {' · '}
                          <button
                            type="button"
                            className="botao-texto"
                            onClick={() => abrirTitular(s.identificador!)}
                          >
                            {s.identificador}
                          </button>
                        </>
                      )}
                    </td>
                    <td>{dia(s.recebidaEm)}</td>
                    <td className={s.vencida ? 'texto-falha' : undefined}>
                      {dia(s.prazoEm)}
                      {s.vencida ? ' (vencido)' : ''}
                    </td>
                    <td>
                      {STATUS[s.status]}
                      {concluida && s.resposta && <small className="mudo bloco">{s.resposta}</small>}
                    </td>
                    <td>
                      {!concluida && (
                        <div className="atender-lgpd">
                          <input
                            placeholder="Resposta dada ao titular"
                            aria-label={`Resposta da solicitação ${s.protocolo}`}
                            value={respostas[s.id] ?? ''}
                            onChange={(e) => setRespostas({ ...respostas, [s.id]: e.target.value })}
                          />
                          {s.status === 'ABERTA' && (
                            <button
                              type="button"
                              className="botao-texto"
                              onClick={() => void mudar(s, 'EM_ANDAMENTO')}
                            >
                              Em andamento
                            </button>
                          )}
                          <button
                            type="button"
                            className="botao-texto"
                            onClick={() => void mudar(s, 'ATENDIDA')}
                          >
                            Atendida
                          </button>
                          <button
                            type="button"
                            className="botao-texto"
                            onClick={() => void mudar(s, 'INDEFERIDA')}
                          >
                            Indeferir
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Titular({ placaInicial }: { placaInicial: string }) {
  const [placa, setPlaca] = useState(placaInicial);
  const [r, setR] = useState<RelatorioTitular | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [confirmar, setConfirmar] = useState(false);

  async function consultar(e?: FormEvent) {
    e?.preventDefault();
    setErro(null);
    setOk(null);
    try {
      setR(await privacidadeApi.relatorio(placa));
    } catch (falha) {
      setR(null);
      setErro(mensagemDe(falha));
    }
  }
  async function anonimizar() {
    setErro(null);
    try {
      const x = await privacidadeApi.anonimizar(placa, motivo);
      setOk(
        `Placa anonimizada: ${x.estadias} estadia(s), ${x.registrosDeHistorico} registro(s) do histórico, ${x.clientesAnonimizados} cadastro(s) de cliente e ${x.removidosDaNuvem} ticket(s) retirados da nuvem. Os valores pagos continuam nos relatórios, sem a placa.`,
      );
      setR(null);
      setConfirmar(false);
    } catch (falha) {
      setErro(mensagemDe(falha));
    }
  }

  return (
    <div>
      <form className="busca-titular" onSubmit={consultar}>
        <label className="campo">
          <span>Placa do titular</span>
          <input value={placa} maxLength={10} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
        </label>
        <button type="submit" className="botao" disabled={!placa}>
          Consultar dados
        </button>
      </form>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {ok && (
        <p className="alerta alerta--ok" role="status">
          {ok}
        </p>
      )}
      {r && (
        <div className="relatorio-titular">
          <h2>Dados de {r.identificador.valor}</h2>
          {r.veiculo ? (
            <p>
              Veículo: {r.veiculo.categoria}
              {r.veiculo.marca ? ` · ${r.veiculo.marca}` : ''}
              {r.veiculo.modelo ? ` ${r.veiculo.modelo}` : ''}
              {r.veiculo.cor ? ` · ${r.veiculo.cor}` : ''}. Cadastrado em {dia(r.veiculo.cadastradoEm)};
              última visita {dia(r.veiculo.ultimaVisitaEm)}.
            </p>
          ) : (
            <p>Sem cadastro de veículo.</p>
          )}
          {r.clientesVinculados.length > 0 && (
            <p>
              Clientes vinculados:{' '}
              {r.clientesVinculados
                .map((c) => `${c.nome}${c.documento ? ` (${c.documento})` : ''}`)
                .join('; ')}
            </p>
          )}
          <p>
            {r.estadias.length} estadia(s).{' '}
            {r.compartilhamento.length
              ? `Na nuvem (app do cliente) até ${quando(r.compartilhamento[0]!.ate)}.`
              : 'Nada na nuvem no momento.'}{' '}
            {r.retencao.anonimizacaoPrevistaEm &&
              `Anonimização automática prevista para ${dia(r.retencao.anonimizacaoPrevistaEm)}.`}
          </p>
          {r.estadias.length > 0 && (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Ticket</th>
                    <th>Entrada</th>
                    <th>Saída</th>
                    <th>Situação</th>
                    <th className="numero">Valor</th>
                    <th>Formas</th>
                  </tr>
                </thead>
                <tbody>
                  {r.estadias.slice(0, 50).map((e) => (
                    <tr key={e.numero}>
                      <td>{e.numero}</td>
                      <td>{quando(e.entradaEm)}</td>
                      <td>{quando(e.saidaEm)}</td>
                      <td>{e.situacao}</td>
                      <td className="numero">
                        {e.valorFinalCentavos === null ? '—' : formatarCentavos(e.valorFinalCentavos)}
                      </td>
                      <td>{e.formasPagamento.join(', ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="acoes">
            <a className="botao botao--secundario" href={privacidadeApi.urlExportacao(placa)} download>
              Baixar dados (portabilidade, JSON)
            </a>
          </div>
          <div className="zona-perigo">
            <h3>Anonimizar</h3>
            {r.emAndamento ? (
              <p className="alerta alerta--info">
                O veículo está no estacionamento. A anonimização só é possível depois da saída (os dados são
                necessários para a cobrança).
              </p>
            ) : (
              <>
                <p className="mudo">
                  A placa é trocada por um código aleatório no veículo, nos tickets, no histórico e na nuvem;
                  o link do cliente para de funcionar. Os valores pagos continuam nos relatórios, sem ligação
                  com a pessoa. Não pode ser desfeito.
                </p>
                <label className="campo">
                  <span>Motivo (ex.: protocolo da solicitação)</span>
                  <input value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} />
                </label>
                {confirmar ? (
                  <div className="acoes">
                    <button
                      type="button"
                      className="botao botao--perigo"
                      onClick={() => void anonimizar()}
                      disabled={motivo.trim().length < 5}
                    >
                      Confirmar anonimização
                    </button>
                    <button
                      type="button"
                      className="botao botao--secundario"
                      onClick={() => setConfirmar(false)}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="acoes">
                    <button
                      type="button"
                      className="botao botao--perigo"
                      onClick={() => setConfirmar(true)}
                      disabled={motivo.trim().length < 5}
                    >
                      Anonimizar esta placa
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Politica() {
  const { temPermissao } = useAuth();
  const pode = temPermissao('config.gerenciar');
  const [p, setP] = useState<PoliticaRetencao | null>(null);
  const [ultima, setUltima] = useState<ResultadoRetencao | null>(null);
  const [enc, setEnc] = useState<EncarregadoDados>({ nome: null, contato: null });
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    privacidadeApi.retencao().then(
      (r) => {
        setP(r.politica);
        setUltima(r.ultimaExecucao);
      },
      (e: unknown) => setMsg({ tipo: 'erro', texto: mensagemDe(e) }),
    );
    privacidadeApi.encarregado().then(setEnc, () => undefined);
  }, []);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!p) return;
    try {
      await privacidadeApi.salvarRetencao(p);
      await privacidadeApi.salvarEncarregado(enc);
      setMsg({ tipo: 'ok', texto: 'Política e encarregado salvos. O contato aparece no app do cliente.' });
    } catch (falha) {
      setMsg({ tipo: 'erro', texto: mensagemDe(falha) });
    }
  }
  async function executar() {
    try {
      const r = await privacidadeApi.executarRetencao();
      setUltima(r);
      setMsg({ tipo: 'ok', texto: 'Retenção aplicada.' });
    } catch (falha) {
      setMsg({ tipo: 'erro', texto: mensagemDe(falha) });
    }
  }
  const num = (k: keyof PoliticaRetencao) => (e: React.ChangeEvent<HTMLInputElement>) =>
    p && setP({ ...p, [k]: Number(e.target.value) });

  return (
    <form onSubmit={salvar}>
      {msg && (
        <p className={`alerta alerta--${msg.tipo}`} role="status">
          {msg.texto}
        </p>
      )}
      <h2>Política de retenção</h2>
      {p && (
        <div className="grade-2">
          <label className="campo">
            <span>Anonimizar placas sem visita há (meses)</span>
            <input
              type="number"
              min={1}
              max={120}
              value={p.placasMeses}
              onChange={num('placasMeses')}
              disabled={!pode}
            />
            <small>Padrão 60 (5 anos, prazo das obrigações fiscais). Valores pagos ficam, sem a placa.</small>
          </label>
          <label className="campo">
            <span>Apagar acessos ao painel (IP e navegador) após (dias)</span>
            <input
              type="number"
              min={7}
              max={3650}
              value={p.acessosPainelDias}
              onChange={num('acessosPainelDias')}
              disabled={!pode}
            />
          </label>
          <label className="campo">
            <span>Apagar histórico de atividades após (meses)</span>
            <input
              type="number"
              min={6}
              max={120}
              value={p.historicoMeses}
              onChange={num('historicoMeses')}
              disabled={!pode}
            />
          </label>
          <label className="campo">
            <span>Apagar identificação do titular das solicitações concluídas após (meses)</span>
            <input
              type="number"
              min={1}
              max={60}
              value={p.solicitacoesMeses}
              onChange={num('solicitacoesMeses')}
              disabled={!pode}
            />
          </label>
        </div>
      )}
      <p className="mudo">
        A retenção roda sozinha todos os dias.{' '}
        {ultima
          ? `Última: ${quando(ultima.executadaEm)} — ${ultima.veiculosAnonimizados} placa(s) anonimizada(s), ${ultima.acessosApagados} acesso(s) e ${ultima.historicoApagado} registro(s) de histórico apagados.`
          : 'Ainda não rodou.'}
      </p>
      <h2>Encarregado pelo tratamento de dados (art. 41)</h2>
      <div className="grade-2">
        <label className="campo">
          <span>Nome</span>
          <input
            value={enc.nome ?? ''}
            maxLength={120}
            onChange={(e) => setEnc({ ...enc, nome: e.target.value || null })}
            disabled={!pode}
          />
        </label>
        <label className="campo">
          <span>Contato (e-mail ou telefone)</span>
          <input
            value={enc.contato ?? ''}
            maxLength={160}
            onChange={(e) => setEnc({ ...enc, contato: e.target.value || null })}
            disabled={!pode}
          />
          <small>Aparece na tela "Privacidade" do app do cliente.</small>
        </label>
      </div>
      {pode && (
        <div className="acoes">
          <button type="submit" className="botao">
            Salvar
          </button>
          <button type="button" className="botao botao--secundario" onClick={() => void executar()}>
            Aplicar retenção agora
          </button>
        </div>
      )}
    </form>
  );
}
