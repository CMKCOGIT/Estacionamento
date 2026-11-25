import { useCallback, useState } from 'react';
import {
  formatarCentavos,
  type FormaPagamento,
  type ListaMovimentacoes,
  type ListaPagamentos,
  type PagamentoRegistro,
  type Pendencia,
  type TipoMovimentacao,
} from '@estacionamento/shared';
import { useAuth } from '../../auth/contexto';
import { useAtualizacaoAutomatica } from '../../hooks/useAtualizacaoAutomatica';
import { useCarregar } from '../../hooks/useCarregar';
import { financeiroApi } from '../../services/financeiro';
import { formatarDataHora } from '../../services/rotulos';
import { duracaoCurta } from '../vagas/MapaVagas';
import { DialogoMotivo } from '../vagas/Dialogos';
import { DialogoDetalhe } from '../relatorios/DialogoDetalhe';
import { DialogoCaixa } from './DialogoCaixa';
import { DialogoReceber } from './DialogoReceber';
import { hojeLocal, ROTULO_MOVIMENTACAO } from './rotulos';
import { TabelaMovimentacoes, TabelaPagamentos } from './Tabelas';

type Avisar = (tipo: 'ok' | 'erro', texto: string) => void;

function Indicador({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: string }) {
  return (
    <div className="cartao indicador-cartao">
      <div className="indicador-cartao__rotulo">{rotulo}</div>
      <div className="indicador-cartao__valor">{valor}</div>
      {extra && <div className="indicador-cartao__extra">{extra}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AbaResumo({ avisar }: { avisar: Avisar }) {
  const { temPermissao } = useAuth();
  const [data, setData] = useState(hojeLocal());
  const [caixa, setCaixa] = useState<string | null>(null);
  const carregar = useCallback(() => financeiroApi.resumo(data), [data]);
  const r = useAtualizacaoAutomatica(carregar, data === hojeLocal() ? 30_000 : 3_600_000);
  const d = r.dados;
  return (
    <>
      <div className="filtros">
        <label className="campo">
          <span>Dia</span>
          <input
            type="date"
            value={data}
            max={hojeLocal()}
            onChange={(e) => e.target.value && setData(e.target.value)}
          />
        </label>
        {r.atualizadoEm && (
          <span className="pequeno mudo">Atualizado às {r.atualizadoEm.toLocaleTimeString('pt-BR')}</span>
        )}
      </div>
      {r.erro && <p className="alerta alerta--erro">{r.erro.message}</p>}
      {d && (
        <>
          <div className="cartoes">
            <Indicador
              rotulo="Total recebido"
              valor={formatarCentavos(d.recebidoCentavos)}
              extra={`${d.quantidadePagamentos} pagamento(s)`}
            />
            <Indicador
              rotulo="Estornos"
              valor={formatarCentavos(d.estornadoCentavos)}
              extra={`${d.quantidadeEstornos} estorno(s)`}
            />
            <Indicador
              rotulo="Líquido do dia"
              valor={formatarCentavos(d.liquidoCentavos)}
              extra={`troco dado ${formatarCentavos(d.trocoCentavos)}`}
            />
            <Indicador
              rotulo="Tickets encerrados"
              valor={String(d.ticketsEncerrados)}
              extra={`${d.ticketsSemCobranca} sem cobrança · médio ${d.ticketMedioCentavos === null ? '—' : formatarCentavos(d.ticketMedioCentavos)}`}
            />
            {d.pendentes && (
              <Indicador
                rotulo="A receber agora"
                valor={formatarCentavos(d.pendentes.totalCentavos)}
                extra={`${d.pendentes.quantidade} ticket(s) aberto(s)`}
              />
            )}
          </div>
          <div className="grade-operacao">
            <section className="cartao">
              <h2>Por forma de pagamento</h2>
              {d.porForma.length === 0 ? (
                <p className="mudo">Nenhum pagamento neste dia.</p>
              ) : (
                <div className="tabela-rolagem">
                  <table className="tabela tabela--compacta">
                    <thead>
                      <tr>
                        <th scope="col">Forma</th>
                        <th scope="col" className="numero">
                          Qtd.
                        </th>
                        <th scope="col" className="numero">
                          Recebido
                        </th>
                        <th scope="col" className="numero">
                          Estornado
                        </th>
                        <th scope="col" className="numero">
                          Líquido
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.porForma.map((f) => (
                        <tr key={f.forma}>
                          <td>{f.nome}</td>
                          <td className="numero">{f.quantidade}</td>
                          <td className="numero">{formatarCentavos(f.recebidoCentavos)}</td>
                          <td className="numero">
                            {f.estornadoCentavos ? `− ${formatarCentavos(f.estornadoCentavos)}` : '—'}
                          </td>
                          <td className="numero">
                            <strong>{formatarCentavos(f.liquidoCentavos)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="tabela__total">
                        <td>Total</td>
                        <td className="numero">{d.quantidadePagamentos}</td>
                        <td className="numero">{formatarCentavos(d.recebidoCentavos)}</td>
                        <td className="numero">
                          {d.estornadoCentavos ? `− ${formatarCentavos(d.estornadoCentavos)}` : '—'}
                        </td>
                        <td className="numero">{formatarCentavos(d.liquidoCentavos)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
              {d.descontosCentavos > 0 && (
                <p className="pequeno mudo">
                  Descontos concedidos no dia: {formatarCentavos(d.descontosCentavos)}
                </p>
              )}
            </section>
            <section className="cartao">
              <h2>Caixas do dia</h2>
              {d.caixas.length === 0 ? (
                <p className="mudo">Nenhum caixa aberto neste dia.</p>
              ) : (
                <div className="tabela-rolagem">
                  <table className="tabela tabela--compacta">
                    <thead>
                      <tr>
                        <th scope="col">Caixa</th>
                        <th scope="col">Situação</th>
                        <th scope="col" className="numero">
                          Recebido
                        </th>
                        <th scope="col" className="numero">
                          Diferença
                        </th>
                        <th scope="col">
                          <span className="sr-only">Detalhe</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.caixas.map((c) => (
                        <tr key={c.id}>
                          <td>
                            {c.posto} · {c.operador}
                            <div className="pequeno mudo">{formatarDataHora(c.abertoEm)}</div>
                          </td>
                          <td>
                            <span
                              className={`etiqueta ${c.status === 'ABERTO' ? 'etiqueta--ativo' : 'etiqueta--inativo'}`}
                            >
                              {c.status === 'ABERTO' ? 'Aberto' : 'Fechado'}
                            </span>
                          </td>
                          <td className="numero">{formatarCentavos(c.recebidoCentavos ?? 0)}</td>
                          <td className={`numero ${c.diferencaCentavos ? 'erro' : ''}`}>
                            {c.diferencaCentavos === null ? '—' : formatarCentavos(c.diferencaCentavos)}
                          </td>
                          <td>
                            <button type="button" className="botao-texto" onClick={() => setCaixa(c.id)}>
                              Ver
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
          {d.porHora.length > 0 && (
            <section className="cartao">
              <h2>Recebimentos por hora</h2>
              <div className="barras-hora" role="list">
                {d.porHora.map((h) => {
                  const max = Math.max(...d.porHora.map((x) => x.recebidoCentavos));
                  return (
                    <div
                      key={h.hora}
                      className="barras-hora__item"
                      role="listitem"
                      title={`${h.quantidade} pagamento(s)`}
                    >
                      <span className="barras-hora__rotulo">{String(h.hora).padStart(2, '0')}h</span>
                      <span
                        className="barras-hora__barra"
                        style={{ width: `${Math.max(2, (h.recebidoCentavos / max) * 100)}%` }}
                      />
                      <span className="barras-hora__valor">{formatarCentavos(h.recebidoCentavos)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
      {caixa && (
        <DialogoCaixa
          caixaId={caixa}
          podeFechar={temPermissao('caixa.supervisionar')}
          onFechar={() => setCaixa(null)}
          onMudou={(t) => {
            avisar('ok', t);
            r.atualizarAgora();
          }}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
export function AbaPagamentos({ formas, avisar }: { formas: FormaPagamento[]; avisar: Avisar }) {
  const { temPermissao } = useAuth();
  const [de, setDe] = useState(hojeLocal());
  const [ate, setAte] = useState(hojeLocal());
  const [forma, setForma] = useState('');
  const [status, setStatus] = useState('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [estornando, setEstornando] = useState<PagamentoRegistro | null>(null);
  const carregar = useCallback(
    () => financeiroApi.pagamentos({ de, ate, forma, status, busca: busca.trim(), pagina }),
    [de, ate, forma, status, busca, pagina],
  );
  const lista = useCarregar<ListaPagamentos>(carregar);
  const mudar = (f: () => void) => {
    setPagina(1);
    f();
  };
  const d = lista.dados;
  return (
    <>
      <div className="filtros cartao">
        <label className="campo">
          <span>De</span>
          <input
            type="date"
            value={de}
            max={ate}
            onChange={(e) => e.target.value && mudar(() => setDe(e.target.value))}
          />
        </label>
        <label className="campo">
          <span>Até</span>
          <input
            type="date"
            value={ate}
            min={de}
            max={hojeLocal()}
            onChange={(e) => e.target.value && mudar(() => setAte(e.target.value))}
          />
        </label>
        <label className="campo">
          <span>Forma</span>
          <select value={forma} onChange={(e) => mudar(() => setForma(e.target.value))}>
            <option value="">Todas</option>
            {formas.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Situação</span>
          <select value={status} onChange={(e) => mudar(() => setStatus(e.target.value))}>
            <option value="">Todos</option>
            <option value="CONFIRMADO">Concluídos</option>
            <option value="ESTORNADO">Estornados</option>
          </select>
        </label>
        <label className="campo campo--crescer">
          <span>Placa ou nº do ticket</span>
          <input
            value={busca}
            onChange={(e) => mudar(() => setBusca(e.target.value.toUpperCase()))}
            maxLength={20}
          />
        </label>
      </div>
      {lista.erro && <p className="alerta alerta--erro">{lista.erro.message}</p>}
      {d && (
        <section className="cartao">
          <p className="resumo-linha">
            <strong>{d.totais.quantidade}</strong> pagamento(s) · concluídos{' '}
            <strong>{formatarCentavos(d.totais.confirmadosCentavos)}</strong>
            {d.totais.estornadosCentavos > 0 && (
              <> · estornados {formatarCentavos(d.totais.estornadosCentavos)}</>
            )}
          </p>
          <TabelaPagamentos
            itens={d.itens}
            onEstornar={temPermissao('pagamento.estornar') ? setEstornando : undefined}
          />
          <Paginas pagina={pagina} proxima={d.proximaPagina} onIr={setPagina} />
        </section>
      )}
      {estornando && (
        <DialogoMotivo
          aberto
          titulo={`Estornar ${formatarCentavos(estornando.valorCentavos)} em ${estornando.formaNome}?`}
          texto={`Ticket nº ${estornando.ticketNumero} (${estornando.placa}). O valor sai do seu caixa e volta a ficar pendente no ticket. Use para pagamento lançado errado ou em dobro.`}
          textoConfirmar="Estornar"
          perigo
          sugestoes={['Lançado na forma errada', 'Cobrado em dobro', 'Valor digitado errado']}
          onFechar={() => setEstornando(null)}
          acao={async (motivo) => {
            await financeiroApi.estornar(estornando.id, motivo);
            return `Pagamento de ${formatarCentavos(estornando.valorCentavos)} estornado.`;
          }}
          onConcluir={(t) => {
            setEstornando(null);
            avisar('ok', t);
            lista.recarregar();
          }}
        />
      )}
    </>
  );
}

function Paginas({
  pagina,
  proxima,
  onIr,
}: {
  pagina: number;
  proxima: number | null;
  onIr: (p: number) => void;
}) {
  if (pagina === 1 && !proxima) return null;
  return (
    <div className="acoes">
      <button
        type="button"
        className="botao botao--secundario botao--pequeno"
        disabled={pagina === 1}
        onClick={() => onIr(pagina - 1)}
      >
        Anterior
      </button>
      <span className="pequeno mudo">Página {pagina}</span>
      <button
        type="button"
        className="botao botao--secundario botao--pequeno"
        disabled={!proxima}
        onClick={() => proxima && onIr(proxima)}
      >
        Próxima
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
export function AbaPendentes({
  formas,
  avisar,
  onAbrirCaixa,
}: {
  formas: FormaPagamento[];
  avisar: Avisar;
  onAbrirCaixa: () => void;
}) {
  const { temPermissao } = useAuth();
  const carregar = useCallback(() => financeiroApi.pendentes(), []);
  const lista = useAtualizacaoAutomatica(carregar, 30_000);
  const [recebendo, setRecebendo] = useState<Pendencia | null>(null);
  const d = lista.dados;
  return (
    <section className="cartao">
      <p className="mudo pequeno">
        Tickets no estacionamento com valor a receber agora (valor acumulado menos o que já foi pago),
        calculado pelo servidor.
      </p>
      {lista.erro && <p className="alerta alerta--erro">{lista.erro.message}</p>}
      {d && (
        <>
          <p className="resumo-linha">
            <strong>{d.quantidade}</strong> ticket(s) · a receber{' '}
            <strong>{formatarCentavos(d.totalCentavos)}</strong>
          </p>
          {d.itens.length === 0 ? (
            <p className="mudo">Nenhum valor pendente.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th scope="col">Ticket</th>
                    <th scope="col">Vaga</th>
                    <th scope="col">Entrada</th>
                    <th scope="col">Tempo</th>
                    <th scope="col" className="numero">
                      Acumulado
                    </th>
                    <th scope="col" className="numero">
                      Já pago
                    </th>
                    <th scope="col" className="numero">
                      A receber
                    </th>
                    <th scope="col">
                      <span className="sr-only">Ações</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.itens.map((p) => (
                    <tr key={p.sessaoId}>
                      <td>
                        nº {p.numero} · <strong>{p.placa}</strong>
                        {p.parcial && <span className="etiqueta etiqueta--bloqueado">Parcial</span>}
                      </td>
                      <td>{p.vaga ?? '—'}</td>
                      <td className="sem-quebra">{formatarDataHora(p.entradaEm)}</td>
                      <td>{duracaoCurta(p.permanenciaMin)}</td>
                      <td className="numero">{formatarCentavos(p.valorAcumuladoCentavos)}</td>
                      <td className="numero">{p.pagoCentavos ? formatarCentavos(p.pagoCentavos) : '—'}</td>
                      <td className="numero">
                        <strong>{formatarCentavos(p.aPagarCentavos)}</strong>
                      </td>
                      <td>
                        {temPermissao('pagamento.registrar') && (
                          <button
                            type="button"
                            className="botao botao--pequeno"
                            onClick={() => setRecebendo(p)}
                          >
                            Receber
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {recebendo && (
        <DialogoReceber
          pendencia={recebendo}
          formas={formas}
          onFechar={() => setRecebendo(null)}
          onAbrirCaixa={() => {
            setRecebendo(null);
            onAbrirCaixa();
          }}
          onRecebido={(r) => {
            setRecebendo(null);
            avisar(
              'ok',
              `${r.repetido ? 'Este pagamento já estava registrado' : 'Pagamento registrado'}: ${formatarCentavos(r.pagamento.valorCentavos)} em ${r.pagamento.formaNome}${r.trocoCentavos ? ` · troco ${formatarCentavos(r.trocoCentavos)}` : ''}. Em aberto agora: ${formatarCentavos(r.sessao.calculo.aPagarCentavos)}.`,
            );
            lista.atualizarAgora();
          }}
        />
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
export function AbaMovimentacoes({ formas }: { formas: FormaPagamento[] }) {
  const [de, setDe] = useState(hojeLocal());
  const [ate, setAte] = useState(hojeLocal());
  const [tipo, setTipo] = useState<'' | TipoMovimentacao>('');
  const [forma, setForma] = useState('');
  const [pagina, setPagina] = useState(1);
  const carregar = useCallback(
    () => financeiroApi.movimentacoes({ de, ate, tipo, forma, pagina }),
    [de, ate, tipo, forma, pagina],
  );
  const lista = useCarregar<ListaMovimentacoes>(carregar);
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const mudar = (f: () => void) => {
    setPagina(1);
    f();
  };
  const d = lista.dados;
  return (
    <>
      <div className="filtros cartao">
        <label className="campo">
          <span>De</span>
          <input
            type="date"
            value={de}
            max={ate}
            onChange={(e) => e.target.value && mudar(() => setDe(e.target.value))}
          />
        </label>
        <label className="campo">
          <span>Até</span>
          <input
            type="date"
            value={ate}
            min={de}
            max={hojeLocal()}
            onChange={(e) => e.target.value && mudar(() => setAte(e.target.value))}
          />
        </label>
        <label className="campo">
          <span>Tipo</span>
          <select
            value={tipo}
            onChange={(e) => mudar(() => setTipo(e.target.value as TipoMovimentacao | ''))}
          >
            <option value="">Todos</option>
            {(Object.keys(ROTULO_MOVIMENTACAO) as TipoMovimentacao[]).map((t) => (
              <option key={t} value={t}>
                {ROTULO_MOVIMENTACAO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Forma</span>
          <select value={forma} onChange={(e) => mudar(() => setForma(e.target.value))}>
            <option value="">Todas</option>
            {formas.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
      </div>
      {lista.erro && <p className="alerta alerta--erro">{lista.erro.message}</p>}
      {d && (
        <section className="cartao">
          <p className="resumo-linha">
            Entradas <strong>{formatarCentavos(d.totais.entradasCentavos)}</strong> · saídas{' '}
            <strong>{formatarCentavos(d.totais.saidasCentavos)}</strong> · saldo{' '}
            <strong>{formatarCentavos(d.totais.entradasCentavos - d.totais.saidasCentavos)}</strong>
          </p>
          <TabelaMovimentacoes itens={d.itens} onDetalhe={(m) => setDetalhe(m.id)} />
          <Paginas pagina={pagina} proxima={d.proximaPagina} onIr={setPagina} />
        </section>
      )}
      {detalhe && <DialogoDetalhe alvo={{ movimentacaoId: detalhe }} onFechar={() => setDetalhe(null)} />}
    </>
  );
}
