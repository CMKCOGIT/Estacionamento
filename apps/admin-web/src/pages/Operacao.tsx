import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  formatarCentavos,
  formatarPlaca,
  normalizarPlaca,
  type AcessoCliente,
  type Categoria,
  type FormaPagamento,
  type Lista,
  type ReciboSaida,
  type SessaoDetalhe,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Placa } from '../components/Placa';
import { BarraCaixa } from '../components/operacao/BarraCaixa';
import { DialogoTicket } from '../components/operacao/DialogoTicket';
import { PainelEntrada } from '../components/operacao/PainelEntrada';
import { PainelSaida } from '../components/operacao/PainelSaida';
import { horaCurta, quandoCurto } from '../components/operacao/util';
import { DialogoMotivo, mensagemDeErro } from '../components/vagas/Dialogos';
import { duracaoCurta } from '../components/vagas/MapaVagas';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { caixaApi, sessoesApi } from '../services/sessoes';
import { vagasApi } from '../services/vagas';

type Ticket = {
  titulo: string;
  sessao: SessaoDetalhe;
  acesso: AcessoCliente;
  veiculoCadastradoAgora?: boolean;
};

export function Operacao() {
  const { temPermissao } = useAuth();
  const podeEntrada = temPermissao('sessao.entrada');
  const podeSaida = temPermissao('sessao.saida');
  const operaCaixa = temPermissao('caixa.operar');
  const podeCancelar = temPermissao('sessao.cancelar');
  const podeNovoLink = temPermissao('sessao.token_revogar');

  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [formas, setFormas] = useState<FormaPagamento[]>([]);
  const [rodada, setRodada] = useState(0);
  const [saida, setSaida] = useState<SessaoDetalhe | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [recibo, setRecibo] = useState<ReciboSaida | null>(null);
  const [cancelando, setCancelando] = useState<SessaoDetalhe | null>(null);
  const [pedirCaixa, setPedirCaixa] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [filtro, setFiltro] = useState('');
  const refSaida = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens))
      .catch(() => undefined);
    if (podeSaida)
      caixaApi
        .formas()
        .then((r) => setFormas(r.itens))
        .catch(() => undefined);
  }, [podeSaida]);

  // Vindo da tela de Vagas ("Dar saída"): abre o ticket direto no painel de saída
  const [parametros, setParametros] = useSearchParams();
  const saidaPedida = parametros.get('saida');
  useEffect(() => {
    if (!saidaPedida || !/^[0-9A-Z]{26}$/.test(saidaPedida)) return;
    let ativo = true;
    sessoesApi
      .obter(saidaPedida)
      .then((s) => {
        if (!ativo) return;
        setSaida(s);
        refSaida.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      })
      .catch((e: unknown) => ativo && setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) }))
      .finally(() => setParametros({}, { replace: true }));
    return () => {
      ativo = false;
    };
  }, [saidaPedida, setParametros]);

  const carregarAbertas = useCallback(() => sessoesApi.abertas(), []);
  const abertas = useAtualizacaoAutomatica<Lista<SessaoDetalhe>>(carregarAbertas, 15_000);
  const carregarCaixa = useCallback(
    () => (operaCaixa ? caixaApi.atual() : Promise.resolve({ caixa: null })),
    [operaCaixa],
  );
  const caixa = useAtualizacaoAutomatica(carregarCaixa, 30_000);

  const mudou = () => {
    setRodada((r) => r + 1);
    abertas.atualizarAgora();
    caixa.atualizarAgora();
  };

  const irParaSaida = (s: SessaoDetalhe) => {
    setSaida(s);
    setMensagem(null);
    refSaida.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  async function irParaSaidaPorPlaca(placa: string) {
    try {
      irParaSaida(await sessoesApi.localizar(placa));
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    }
  }

  async function novoLink(s: SessaoDetalhe) {
    try {
      setTicket({ titulo: 'Novo link do cliente', sessao: s, acesso: await sessoesApi.novoLink(s.id) });
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    }
  }

  const termo = normalizarPlaca(filtro);
  const itens = (abertas.dados?.itens ?? []).filter(
    (s) =>
      !termo ||
      s.placa.includes(termo) ||
      s.numero === filtro.trim() ||
      s.vaga?.toUpperCase().includes(termo),
  );

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Entrada e saída</h1>
          <p className="mudo">
            Registre a chegada e a saída dos veículos. Funciona sem internet, direto no servidor local.
          </p>
        </div>
      </header>

      {operaCaixa && (
        <BarraCaixa
          caixa={caixa.dados?.caixa ?? null}
          carregando={caixa.atualizando}
          pedirAbertura={pedirCaixa}
          onPedidoAtendido={() => setPedirCaixa(false)}
          onMudou={(texto) => {
            setMensagem({ tipo: 'ok', texto });
            caixa.atualizarAgora();
          }}
        />
      )}

      {mensagem && (
        <p className={`alerta alerta--${mensagem.tipo}`} role="status">
          {mensagem.texto}
        </p>
      )}

      <div className="grade-operacao">
        {podeEntrada && (
          <PainelEntrada
            categorias={categorias}
            rodada={rodada}
            onIrParaSaida={(p) => void irParaSaidaPorPlaca(p)}
            onEntrou={(r) => {
              setMensagem(null);
              setTicket({
                titulo: 'Entrada registrada',
                sessao: r.sessao,
                acesso: r.acesso,
                veiculoCadastradoAgora: r.veiculoCadastradoAgora,
              });
              mudou();
            }}
          />
        )}
        {podeSaida && (
          <div ref={refSaida} className="grade-operacao__saida">
            <PainelSaida
              sessao={saida}
              onSessao={setSaida}
              formas={formas}
              caixaAberto={!!caixa.dados?.caixa}
              podeReceber={temPermissao('pagamento.registrar') && operaCaixa}
              podeAjustar={temPermissao('sessao.ajustar_valor')}
              onAbrirCaixa={() => setPedirCaixa(true)}
              onSaiu={(r) => {
                setSaida(null);
                setRecibo(r);
                mudou();
              }}
            />
          </div>
        )}
      </div>

      <section className="cartao" aria-labelledby="titulo-estacionados">
        <div className="cartao__topo">
          <h2 id="titulo-estacionados">
            No estacionamento agora <span className="mudo">({abertas.dados?.itens.length ?? '…'})</span>
          </h2>
          <label className="campo campo--filtro">
            <span className="sr-only">Filtrar</span>
            <input
              value={filtro}
              onChange={(e) => setFiltro(e.target.value.toUpperCase())}
              placeholder="Filtrar por placa, vaga ou nº"
              spellCheck={false}
            />
          </label>
        </div>
        {abertas.erro && (
          <p className="alerta alerta--erro" role="alert">
            {abertas.erro.message}
          </p>
        )}
        {abertas.dados && itens.length === 0 ? (
          <p className="mudo">
            {filtro ? 'Nenhum veículo encontrado com esse filtro.' : 'Nenhum veículo estacionado.'}
          </p>
        ) : (
          <div className="tabela-rolagem">
            <table className="tabela tabela--compacta">
              <thead>
                <tr>
                  <th scope="col">Nº</th>
                  <th scope="col">Placa</th>
                  <th scope="col">Vaga</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Entrada</th>
                  <th scope="col">Tempo</th>
                  <th scope="col" className="numero">
                    Valor até agora
                  </th>
                  <th scope="col">
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {itens.map((s) => (
                  <tr key={s.id} className={saida?.id === s.id ? 'linha-selecionada' : undefined}>
                    <td>{s.numero}</td>
                    <td>
                      <Placa placa={s.placa} />
                    </td>
                    <td>
                      <strong>{s.vaga ?? '—'}</strong>
                    </td>
                    <td>{s.categoria}</td>
                    <td className="sem-quebra">{horaCurta(s.entradaEm)}</td>
                    <td className="sem-quebra">{duracaoCurta(s.calculo.permanenciaMin)}</td>
                    <td className="numero">
                      {formatarCentavos(s.calculo.aPagarCentavos)}
                      {s.calculo.proximaCobranca && (
                        <span className="valor-proximo">
                          {formatarCentavos(s.calculo.proximaCobranca.valorCentavos)} a partir de{' '}
                          {quandoCurto(s.calculo.proximaCobranca.em)}
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="acoes acoes--tabela">
                        {podeSaida && (
                          <button
                            type="button"
                            className="botao botao--pequeno"
                            onClick={() => irParaSaida(s)}
                          >
                            Saída
                          </button>
                        )}
                        {podeNovoLink && (
                          <button
                            type="button"
                            className="botao botao--secundario botao--pequeno"
                            onClick={() => void novoLink(s)}
                            title="Gera um novo QR/link e invalida o anterior"
                          >
                            Novo link
                          </button>
                        )}
                        {podeCancelar && (
                          <button
                            type="button"
                            className="botao-texto"
                            onClick={() => setCancelando(s)}
                            title="Para entradas registradas por engano"
                          >
                            Cancelar
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {ticket && (
        <DialogoTicket
          titulo={ticket.titulo}
          sessao={ticket.sessao}
          acesso={ticket.acesso}
          veiculoCadastradoAgora={ticket.veiculoCadastradoAgora}
          onFechar={() => setTicket(null)}
        />
      )}
      {recibo && <DialogoRecibo recibo={recibo} onFechar={() => setRecibo(null)} />}
      {cancelando && (
        <DialogoMotivo
          aberto
          titulo={`Cancelar o ticket nº ${cancelando.numero}?`}
          texto={`Use só para entrada registrada por engano. A vaga ${cancelando.vaga ?? ''} é liberada, nada é cobrado e o link do cliente deixa de funcionar. Fica registrado no histórico.`}
          textoConfirmar="Cancelar ticket"
          perigo
          sugestoes={['Entrada registrada por engano', 'Placa digitada errada', 'Veículo desistiu de entrar']}
          onFechar={() => setCancelando(null)}
          acao={async (motivo) => {
            await sessoesApi.cancelar(cancelando.id, motivo);
            if (saida?.id === cancelando.id) setSaida(null);
            return `Ticket nº ${cancelando.numero} (${formatarPlaca(cancelando.placa)}) cancelado.`;
          }}
          onConcluir={(texto) => {
            setCancelando(null);
            setMensagem({ tipo: 'ok', texto });
            mudou();
          }}
        />
      )}
    </>
  );
}

function DialogoRecibo({ recibo, onFechar }: { recibo: ReciboSaida; onFechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  const s = recibo.sessao;
  const pagos = s.pagamentos.filter((p) => p.status === 'CONFIRMADO');
  return (
    <dialog ref={ref} className="dialogo" onClose={onFechar} aria-labelledby="recibo-titulo">
      <h2 id="recibo-titulo">Saída registrada</h2>
      {recibo.trocoTotalCentavos > 0 && (
        <p className="recibo__troco" role="status">
          Troco: <strong>{formatarCentavos(recibo.trocoTotalCentavos)}</strong>
        </p>
      )}
      <div className="fechamento__topo">
        <Placa placa={s.placa} grande />
        <span>
          Ticket <strong>nº {s.numero}</strong> · vaga {s.vaga ?? '—'} liberada
        </span>
      </div>
      <dl className="lista-dados">
        <dt>Entrada</dt>
        <dd>{horaCurta(s.entradaEm)}</dd>
        <dt>Saída</dt>
        <dd>{s.saidaEm ? horaCurta(s.saidaEm) : '—'}</dd>
        <dt>Permanência</dt>
        <dd>{duracaoCurta(s.calculo.permanenciaMin)}</dd>
        <dt>Tarifa</dt>
        <dd>
          {s.tarifaAplicada.nome}
          {s.tarifaAplicada.tabelaVersao !== null && ` (v${s.tarifaAplicada.tabelaVersao})`}
        </dd>
        {s.calculo.itens.map((i) => (
          <FragmentoPagamento
            key={`calc-${i.descricao}`}
            nome={`${i.quantidade > 1 ? `${i.quantidade} × ` : ''}${i.descricao}`}
            valor={i.totalCentavos}
            recebido={null}
          />
        ))}
        <dt>Valor final</dt>
        <dd>
          <strong>{formatarCentavos(s.valorFinalCentavos ?? 0)}</strong>
        </dd>
        {pagos.map((p) => (
          <FragmentoPagamento
            key={p.id}
            nome={p.formaNome}
            valor={p.valorCentavos}
            recebido={p.valorRecebidoCentavos}
          />
        ))}
      </dl>
      <div className="acoes acoes--direita">
        <button type="button" className="botao" onClick={() => ref.current?.close()} autoFocus>
          Concluir
        </button>
      </div>
    </dialog>
  );
}

function FragmentoPagamento({
  nome,
  valor,
  recebido,
}: {
  nome: string;
  valor: number;
  recebido: number | null;
}) {
  return (
    <>
      <dt>{nome}</dt>
      <dd>
        {formatarCentavos(valor)}
        {recebido !== null && recebido > valor && (
          <span className="mudo"> (recebido {formatarCentavos(recebido)})</span>
        )}
      </dd>
    </>
  );
}
