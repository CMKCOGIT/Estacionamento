import { useCallback, useEffect, useRef, useState } from 'react';
import { formatarCentavos } from '@estacionamento/shared';
import { useCarregar } from '../../hooks/useCarregar';
import { relatoriosApi } from '../../services/relatorios';
import { formatarDataHora, ROTULOS_ACOES } from '../../services/rotulos';
import { ROTULO_MOVIMENTACAO } from '../financeiro/rotulos';
import { Placa } from '../Placa';
import { duracaoCurta } from '../vagas/MapaVagas';

type Alvo = { movimentacaoId: string } | { pagamentoId: string };

/** Detalhe de uma movimentação ou pagamento: de onde veio, ticket, caixa, relacionadas e histórico. */
export function DialogoDetalhe({ alvo: inicial, onFechar }: { alvo: Alvo; onFechar: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [alvo, setAlvo] = useState<Alvo>(inicial);
  const carregar = useCallback(() => relatoriosApi.detalhe(alvo), [alvo]);
  const { dados: d, erro, carregando } = useCarregar(carregar);
  useEffect(() => {
    const el = ref.current;
    if (el && !el.open) el.showModal();
  }, []);
  const m = d?.movimentacao;
  const p = d?.pagamento;
  const t = d?.ticket;

  return (
    <dialog ref={ref} className="dialogo dialogo--largo" onClose={onFechar} aria-labelledby="detalhe-titulo">
      <h2 id="detalhe-titulo">
        {m
          ? `${ROTULO_MOVIMENTACAO[m.tipo]} · ${formatarCentavos(m.valorCentavos)}`
          : p
            ? `Pagamento · ${formatarCentavos(p.valorCentavos)}`
            : 'Detalhe'}
      </h2>
      {carregando && !d && <p className="mudo">Carregando…</p>}
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {d && (
        <div className="detalhe-financeiro">
          {m && (
            <section>
              <h3>Movimentação</h3>
              <dl className="lista-dados">
                <dt>Quando</dt>
                <dd>{formatarDataHora(m.registradoEm)}</dd>
                <dt>Tipo</dt>
                <dd>
                  {ROTULO_MOVIMENTACAO[m.tipo]} (
                  {m.direcao === 'ENTRADA' ? 'entrada no caixa' : 'saída do caixa'})
                </dd>
                <dt>Forma</dt>
                <dd>{m.formaNome}</dd>
                <dt>Valor</dt>
                <dd>
                  <strong>
                    {m.direcao === 'SAIDA' ? '− ' : ''}
                    {formatarCentavos(m.valorCentavos)}
                  </strong>
                </dd>
                <dt>Registrada por</dt>
                <dd>{m.registradoPor ?? '—'}</dd>
                {m.descricao && (
                  <>
                    <dt>Descrição</dt>
                    <dd>{m.descricao}</dd>
                  </>
                )}
              </dl>
            </section>
          )}
          {p && (
            <section>
              <h3>Pagamento</h3>
              <dl className="lista-dados">
                <dt>Situação</dt>
                <dd>
                  {p.status === 'CONFIRMADO' ? (
                    <span className="etiqueta etiqueta--ativo">Concluído</span>
                  ) : (
                    <span className="etiqueta etiqueta--inativo">Estornado</span>
                  )}
                </dd>
                <dt>Registrado</dt>
                <dd>
                  {formatarDataHora(p.registradoEm)} por {p.registradoPor ?? '—'}
                </dd>
                <dt>Forma</dt>
                <dd>
                  {p.formaNome}
                  {p.parcelas > 1 ? ` em ${p.parcelas}×` : ''}
                  {p.autorizacao ? ` · autorização ${p.autorizacao}` : ''}
                </dd>
                <dt>Valor</dt>
                <dd>{formatarCentavos(p.valorCentavos)}</dd>
                {p.valorRecebidoCentavos !== null && (
                  <>
                    <dt>Recebido / troco</dt>
                    <dd>
                      {formatarCentavos(p.valorRecebidoCentavos)} / {formatarCentavos(p.trocoCentavos)}
                    </dd>
                  </>
                )}
                {p.estornadoEm && (
                  <>
                    <dt>Estornado</dt>
                    <dd>
                      {formatarDataHora(p.estornadoEm)} por {p.estornadoPor ?? '—'} — {p.motivoEstorno}
                    </dd>
                  </>
                )}
              </dl>
            </section>
          )}
          {t && (
            <section>
              <h3>Ticket nº {t.numero}</h3>
              <div className="fechamento__topo">
                <Placa placa={t.placa} />
                <span className="mudo">
                  {t.categoria} · vaga {t.vaga ?? '—'} ·{' '}
                  {t.status === 'ABERTA'
                    ? 'no estacionamento'
                    : t.status === 'ENCERRADA'
                      ? 'encerrado'
                      : 'cancelado'}
                </span>
              </div>
              <dl className="lista-dados">
                <dt>Entrada</dt>
                <dd>{formatarDataHora(t.entradaEm)}</dd>
                {t.saidaEm && (
                  <>
                    <dt>Saída</dt>
                    <dd>{formatarDataHora(t.saidaEm)}</dd>
                  </>
                )}
                <dt>Permanência</dt>
                <dd>{duracaoCurta(t.calculo.permanenciaMin)}</dd>
                <dt>Tarifa</dt>
                <dd>
                  {t.tarifaAplicada.nome}
                  {t.tarifaAplicada.tabelaVersao !== null &&
                    ` (tabela v${t.tarifaAplicada.tabelaVersao})`} — {t.calculo.tarifa}
                </dd>
                {t.calculo.itens.length > 0 && (
                  <>
                    <dt>Cálculo</dt>
                    <dd>
                      <ul className="itens-calculo">
                        {t.calculo.itens.map((i) => (
                          <li key={i.descricao}>
                            <span>
                              {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
                              {i.descricao}
                            </span>
                            <span>{formatarCentavos(i.totalCentavos)}</span>
                          </li>
                        ))}
                      </ul>
                    </dd>
                  </>
                )}
                <dt>{t.status === 'ENCERRADA' ? 'Valor final' : 'Valor até agora'}</dt>
                <dd>
                  <strong>
                    {formatarCentavos(t.valorFinalCentavos ?? t.calculo.valorCalculadoCentavos)}
                  </strong>
                  {t.calculo.pagoCentavos > 0 && (
                    <span className="mudo"> · pago {formatarCentavos(t.calculo.pagoCentavos)}</span>
                  )}
                </dd>
              </dl>
            </section>
          )}
          {d.caixa && (
            <section>
              <h3>Caixa</h3>
              <p>
                {d.caixa.posto} · {d.caixa.operador} · aberto em {formatarDataHora(d.caixa.abertoEm)}
                {d.caixa.fechadoEm ? `, fechado em ${formatarDataHora(d.caixa.fechadoEm)}` : ' (aberto)'}
              </p>
            </section>
          )}
          {d.relacionadas.length > 0 && (
            <section>
              <h3>Movimentações relacionadas</h3>
              <ul className="lista-simples">
                {d.relacionadas.map((r) => (
                  <li key={r.id}>
                    <button
                      type="button"
                      className="botao-texto"
                      onClick={() => setAlvo({ movimentacaoId: r.id })}
                    >
                      {formatarDataHora(r.registradoEm)} · {ROTULO_MOVIMENTACAO[r.tipo]} · {r.formaNome} ·{' '}
                      {r.direcao === 'SAIDA' ? '− ' : ''}
                      {formatarCentavos(r.valorCentavos)}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {d.historico.length > 0 && (
            <section>
              <h3>Histórico</h3>
              <ul className="lista-simples">
                {d.historico.map((h, i) => (
                  <li key={`${h.acao}-${i}`}>
                    {formatarDataHora(h.em)} · {ROTULOS_ACOES[h.acao] ?? h.acao}
                    {h.usuario ? ` · ${h.usuario}` : ''}
                    {h.motivo ? <span className="mudo"> — {h.motivo}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
      <div className="acoes acoes--direita">
        <button type="button" className="botao" onClick={() => ref.current?.close()} autoFocus>
          Fechar
        </button>
      </div>
    </dialog>
  );
}
