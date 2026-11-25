import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  centavosParaCampo,
  formatarCentavos,
  lerCentavos,
  type FormaPagamento,
  type PreviaSaida,
  type ReciboSaida,
  type SessaoDetalhe,
} from '@estacionamento/shared';
import { useConfigPainel } from '../../hooks/useConfigPainel';
import { ErroDaApi } from '../../services/api';
import { Dialogo } from '../Dialogo';
import { formatarDataHora } from '../../services/rotulos';
import { sessoesApi } from '../../services/sessoes';
import { Placa } from '../Placa';
import { duracaoCurta } from '../vagas/MapaVagas';
import { mensagemDeErro } from '../vagas/Dialogos';
import { novoUuid, quandoCurto } from './util';

interface Linha {
  chave: string;
  forma: string;
  /** null = automático: o que faltar para completar o valor a pagar (muda com o tempo e com o desconto). */
  valor: string | null;
  recebido: string;
}

interface Props {
  sessao: SessaoDetalhe | null;
  onSessao: (s: SessaoDetalhe | null) => void;
  formas: FormaPagamento[];
  caixaAberto: boolean;
  podeReceber: boolean;
  podeAjustar: boolean;
  onAbrirCaixa: () => void;
  onSaiu: (r: ReciboSaida) => void;
}

const novaLinha = (forma: string, centavos: number | null): Linha => ({
  chave: novoUuid(),
  forma,
  valor: centavos === null ? null : centavosParaCampo(centavos),
  recebido: '',
});

export function PainelSaida({
  sessao,
  onSessao,
  formas,
  caixaAberto,
  podeReceber,
  podeAjustar,
  onAbrirCaixa,
  onSaiu,
}: Props) {
  const [termo, setTermo] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  async function localizar(e: FormEvent) {
    e.preventDefault();
    if (!termo.trim()) return;
    setBuscando(true);
    setErroBusca(null);
    try {
      const s = await sessoesApi.localizar(termo.trim());
      if (s.status !== 'ABERTA') {
        setErroBusca(
          `O ticket nº ${s.numero} (${s.placa}) já foi ${s.status === 'ENCERRADA' ? 'encerrado' : 'cancelado'} em ${formatarDataHora(s.saidaEm)}. Não há estadia aberta para registrar saída.`,
        );
        onSessao(null);
      } else {
        onSessao(s);
        setTermo('');
      }
    } catch (falha) {
      setErroBusca(mensagemDeErro(falha));
      onSessao(null);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <section className="cartao painel-op" aria-labelledby="titulo-saida">
      <h2 id="titulo-saida">Saída</h2>
      <form className="linha-busca" onSubmit={localizar}>
        <label className="campo campo--crescer">
          <span>Placa ou nº do ticket</span>
          <input
            value={termo}
            onChange={(e) => setTermo(e.target.value.toUpperCase())}
            placeholder="ABC1D23 ou 125"
            maxLength={20}
            autoComplete="off"
            spellCheck={false}
            className="entrada-placa"
          />
        </label>
        <button type="submit" className="botao botao--secundario" disabled={buscando || !termo.trim()}>
          {buscando ? 'Buscando…' : 'Localizar'}
        </button>
      </form>
      {erroBusca && (
        <p className="alerta alerta--erro" role="alert">
          {erroBusca}
        </p>
      )}
      {sessao ? (
        <Fechamento
          key={sessao.id}
          sessao={sessao}
          onSessao={onSessao}
          formas={formas}
          caixaAberto={caixaAberto}
          podeReceber={podeReceber}
          podeAjustar={podeAjustar}
          onAbrirCaixa={onAbrirCaixa}
          onSaiu={onSaiu}
        />
      ) : (
        !erroBusca && (
          <p className="mudo pequeno">
            Digite a placa ou o número do ticket, ou clique em “Saída” na lista abaixo.
          </p>
        )
      )}
    </section>
  );
}

/** Texto digitado → centavos. Vazio vale 0 (o servidor aponta o que falta). */
const centavosDoCampo = (texto: string): number | null => (texto.trim() ? lerCentavos(texto) : 0);

function Fechamento({
  sessao,
  onSessao,
  formas,
  caixaAberto,
  podeReceber,
  podeAjustar,
  onAbrirCaixa,
  onSaiu,
}: Omit<Props, 'sessao'> & { sessao: SessaoDetalhe }) {
  const formaPadrao = formas[0]?.codigo ?? 'DINHEIRO';
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha(formaPadrao, null)]);
  const [desconto, setDesconto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const prefs = useConfigPainel().operacao;
  const [confirmando, setConfirmando] = useState(false);
  const refForm = useRef<HTMLFormElement>(null);
  const [erro, setErro] = useState<{ texto: string; abrirCaixa?: boolean } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [previa, setPrevia] = useState<PreviaSaida | null>(null);
  const [erroPrevia, setErroPrevia] = useState<string | null>(null);
  const [rodada, setRodada] = useState(0);
  const ultimoValor = useRef(sessao.calculo.valorCalculadoCentavos);

  const formaDe = (codigo: string) => formas.find((f) => f.codigo === codigo);

  // O pedido montado a partir do que foi digitado (só conversão de texto; nenhuma conta aqui)
  const descontoCentavos = centavosDoCampo(desconto);
  const pagamentos = linhas.map((l) => ({
    forma: l.forma,
    valorCentavos: l.valor === null ? null : centavosDoCampo(l.valor),
    valorRecebidoCentavos:
      formaDe(l.forma)?.permiteTroco && l.recebido.trim() ? lerCentavos(l.recebido) : null,
  }));
  const digitacaoInvalida =
    descontoCentavos === null
      ? 'Desconto inválido. Use o formato 10,00.'
      : linhas.some((l, i) => l.valor !== null && pagamentos[i]!.valorCentavos === null)
        ? 'Valor de pagamento inválido. Use o formato 10,00.'
        : linhas.some((l, i) => l.recebido.trim() && pagamentos[i]!.valorRecebidoCentavos === null)
          ? 'Valor recebido inválido. Use o formato 10,00.'
          : null;
  const pedido = digitacaoInvalida
    ? null
    : { descontoCentavos: descontoCentavos ?? 0, acrescimoCentavos: 0, pagamentos };
  const chavePedido = JSON.stringify(pedido);

  // Prévia calculada pelo servidor a cada mudança (e quando o valor da estadia sobe)
  useEffect(() => {
    if (!chavePedido || chavePedido === 'null') return;
    let ativo = true;
    const t = setTimeout(() => {
      sessoesApi
        .previaSaida(sessao.id, JSON.parse(chavePedido))
        .then((p) => {
          if (!ativo) return;
          if (p.calculo.valorCalculadoCentavos !== ultimoValor.current) {
            setAviso(
              `O valor subiu de ${formatarCentavos(ultimoValor.current)} para ${formatarCentavos(p.calculo.valorCalculadoCentavos)} (passou mais uma fração de tempo).`,
            );
            ultimoValor.current = p.calculo.valorCalculadoCentavos;
          }
          setPrevia(p);
          setErroPrevia(null);
        })
        .catch((falha) => {
          if (!ativo) return;
          if (falha instanceof ErroDaApi && falha.status === 409) {
            onSessao(null);
            return;
          }
          setErroPrevia(mensagemDeErro(falha));
        });
    }, 200);
    return () => {
      ativo = false;
      clearTimeout(t);
    };
  }, [chavePedido, sessao.id, rodada, onSessao]);

  // Recalcula no instante em que o valor sobe (e a cada minuto, por garantia)
  const proxima = previa?.calculo.proximaCobranca ?? null;
  useEffect(() => {
    const ate = proxima ? new Date(proxima.em).getTime() - Date.now() + 500 : 60_000;
    const t = setTimeout(() => setRodada((r) => r + 1), Math.min(Math.max(ate, 1000), 60_000));
    return () => clearTimeout(t);
  }, [proxima, rodada]);

  const c = previa?.calculo ?? sessao.calculo;
  const aPagar = previa?.aPagarCentavos ?? null;
  const linhaDaPrevia = (i: number) => previa?.pagamentos.find((p) => p.linha === i);
  const problemasDaLinha = (i: number) => previa?.problemas.filter((p) => p.linha === i) ?? [];
  const problemasGerais = previa?.problemas.filter((p) => p.linha === undefined) ?? [];
  const pedeCaixa = problemasGerais.some((p) => p.acao === 'ABRIR_CAIXA');

  const mudar = (i: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    // Configurações → Operação: confirmação antes de encerrar (valor e formas)
    if (prefs.confirmarSaida && !confirmando) {
      if (digitacaoInvalida) return setErro({ texto: digitacaoInvalida });
      if (!previa || !pedido) return setErro({ texto: 'Aguarde o cálculo do valor.' });
      if (previa.problemas[0])
        return setErro({
          texto: previa.problemas[0].mensagem,
          abrirCaixa: previa.problemas[0].acao === 'ABRIR_CAIXA',
        });
      setConfirmando(true);
      return;
    }
    setConfirmando(false);
    if (digitacaoInvalida) return setErro({ texto: digitacaoInvalida });
    if (!previa || !pedido) return setErro({ texto: 'Aguarde o cálculo do valor.' });
    if (pedido.descontoCentavos > 0 && motivo.trim().length < 3)
      return setErro({ texto: 'Informe o motivo do desconto.' });
    const problema = previa.problemas[0];
    if (problema) return setErro({ texto: problema.mensagem, abrirCaixa: problema.acao === 'ABRIR_CAIXA' });
    setEnviando(true);
    try {
      const recibo = await sessoesApi.saida(sessao.id, {
        // O servidor confere: se o valor tiver subido desde a prévia, pede nova conferência
        valorEsperadoCentavos: previa.calculo.valorCalculadoCentavos,
        descontoCentavos: pedido.descontoCentavos,
        motivoAjuste: pedido.descontoCentavos ? motivo.trim() : null,
        pagamentos:
          previa.aPagarCentavos > 0
            ? pedido.pagamentos.map((p, i) => ({ ...p, chaveIdempotencia: linhas[i]!.chave }))
            : [],
      });
      onSaiu(recibo);
    } catch (falha) {
      if (falha instanceof ErroDaApi && !Array.isArray(falha.corpo.detalhes)) {
        const d = falha.corpo.detalhes;
        if (d?.acao === 'ABRIR_CAIXA') return setErro({ texto: falha.message, abrirCaixa: true });
        if (typeof d?.valorCalculadoCentavos === 'number') {
          setAviso(falha.message);
          setRodada((r) => r + 1);
          return;
        }
      }
      setErro({ texto: mensagemDeErro(falha) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Dialogo
        aberto={confirmando}
        titulo="Confirmar saída"
        textoConfirmar="Confirmar saída"
        onFechar={() => setConfirmando(false)}
        onConfirmar={() => refForm.current?.requestSubmit()}
      >
        {previa && (
          <p>
            Encerrar o ticket da placa <strong>{sessao.placa}</strong>
            {sessao.vaga ? ` (vaga ${sessao.vaga})` : ''} com{' '}
            <strong>{formatarCentavos(previa.aPagarCentavos)}</strong> a receber
            {previa.pagamentos.length > 0 && ` em ${previa.pagamentos.map((p) => p.formaNome).join(' + ')}`}?
            A vaga é liberada na hora.
          </p>
        )}
      </Dialogo>
      <form className="fechamento" onSubmit={confirmar} ref={refForm}>
        <div className="fechamento__topo">
          <Placa placa={sessao.placa} grande />
          <div>
            <div>
              Ticket <strong>nº {sessao.numero}</strong> · vaga <strong>{sessao.vaga ?? '—'}</strong>
            </div>
            <div className="mudo pequeno">
              {sessao.categoria} · {sessao.modalidade === 'DIARIA' ? 'Diária' : 'Avulso'}
            </div>
          </div>
        </div>
        <dl className="lista-dados">
          <dt>Entrada</dt>
          <dd>{formatarDataHora(sessao.entradaEm)}</dd>
          <dt>Permanência</dt>
          <dd>{duracaoCurta(c.permanenciaMin)}</dd>
          <dt>Tarifa</dt>
          <dd>
            {sessao.tarifaAplicada.tipo === 'ESPECIAL' && <strong>{sessao.tarifaAplicada.nome}: </strong>}
            {c.tarifa}
            {sessao.tarifaAplicada.tabelaVersao !== null && (
              <span className="mudo"> (tabela v{sessao.tarifaAplicada.tabelaVersao}, da entrada)</span>
            )}
          </dd>
          {c.itens.length > 0 && (
            <>
              <dt>Cálculo</dt>
              <dd>
                <ul className="itens-calculo">
                  {c.itens.map((i) => (
                    <li key={i.descricao}>
                      <span>
                        {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
                        {i.descricao}
                      </span>
                      <span>{formatarCentavos(i.totalCentavos)}</span>
                    </li>
                  ))}
                  {previa && previa.descontoCentavos > 0 && (
                    <li>
                      <span>Desconto</span>
                      <span>− {formatarCentavos(previa.descontoCentavos)}</span>
                    </li>
                  )}
                </ul>
              </dd>
            </>
          )}
          {c.pagoCentavos > 0 && (
            <>
              <dt>Já pago</dt>
              <dd>{formatarCentavos(c.pagoCentavos)}</dd>
            </>
          )}
        </dl>
        {aviso && (
          <p className="alerta alerta--info" role="status">
            {aviso} Confira o novo valor.
          </p>
        )}
        <p className="fechamento__total">
          <span>A pagar</span>
          <strong>{aPagar === null ? '…' : formatarCentavos(aPagar)}</strong>
        </p>
        {proxima && (
          <p className="pequeno mudo fechamento__proxima">
            O valor passa a {formatarCentavos(proxima.valorCentavos)} a partir de {quandoCurto(proxima.em)}.
          </p>
        )}
        {erroPrevia && (
          <p className="alerta alerta--erro" role="alert">
            {erroPrevia}
          </p>
        )}

        {podeAjustar && (
          <details className="fechamento__ajuste" open={!!desconto}>
            <summary>Conceder desconto</summary>
            <div className="grade-campos">
              <label className="campo">
                <span>Desconto (R$)</span>
                <input
                  value={desconto}
                  onChange={(e) => setDesconto(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                />
              </label>
              <label className="campo">
                <span>Motivo{descontoCentavos ? ' *' : ''}</span>
                <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={255} />
              </label>
            </div>
          </details>
        )}

        {aPagar === 0 ? (
          <p className="alerta alerta--ok">
            {c.valorCalculadoCentavos === 0 ? 'Dentro da tolerância: sem cobrança.' : 'Nada a pagar.'}
          </p>
        ) : !podeReceber ? (
          <p className="alerta alerta--erro">Você não tem permissão para receber pagamentos.</p>
        ) : (
          <fieldset className="pagamentos">
            <legend>Pagamento</legend>
            {linhas.map((l, i) => {
              const f = formaDe(l.forma);
              const conferido = linhaDaPrevia(i);
              return (
                <div key={l.chave} className="pagamento">
                  <label className="campo">
                    <span>Forma</span>
                    <select value={l.forma} onChange={(e) => mudar(i, 'forma', e.target.value)}>
                      {formas.map((x) => (
                        <option key={x.codigo} value={x.codigo}>
                          {x.nome}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="campo">
                    <span>Valor (R$)</span>
                    <input
                      value={l.valor ?? (conferido ? centavosParaCampo(conferido.valorCentavos) : '')}
                      onChange={(e) => mudar(i, 'valor', e.target.value)}
                      inputMode="decimal"
                      placeholder={l.valor === null ? 'O que faltar' : '0,00'}
                    />
                    {l.valor === null && linhas.length > 1 && (
                      <small className="mudo">completa o restante</small>
                    )}
                  </label>
                  {f?.permiteTroco && (
                    <label className="campo">
                      <span>Recebido (R$)</span>
                      <input
                        value={l.recebido}
                        onChange={(e) => mudar(i, 'recebido', e.target.value)}
                        inputMode="decimal"
                        placeholder="Para calcular o troco"
                      />
                    </label>
                  )}
                  {linhas.length > 1 && (
                    <button
                      type="button"
                      className="botao-texto pagamento__remover"
                      onClick={() =>
                        setLinhas((ls) => {
                          const resto = ls.filter((_, j) => j !== i);
                          return resto.length === 1 ? [{ ...resto[0]!, valor: null }] : resto;
                        })
                      }
                      aria-label={`Remover pagamento ${i + 1}`}
                    >
                      Remover
                    </button>
                  )}
                  {conferido && conferido.trocoCentavos > 0 && (
                    <p className="pequeno pagamento__aviso">
                      Troco deste pagamento: {formatarCentavos(conferido.trocoCentavos)}
                    </p>
                  )}
                  {problemasDaLinha(i).map((p) => (
                    <p key={p.mensagem} className="pequeno erro pagamento__aviso">
                      {p.mensagem}
                    </p>
                  ))}
                </div>
              );
            })}
            <div className="pagamentos__rodape">
              <button
                type="button"
                className="botao-texto"
                onClick={() =>
                  setLinhas((ls) => [
                    ...ls,
                    { ...novaLinha(formas[1]?.codigo ?? formaPadrao, null), valor: '' },
                  ])
                }
                disabled={linhas.length >= 4}
              >
                + Dividir em outra forma
              </button>
              {previa && previa.diferencaCentavos !== 0 && (
                <span className="erro pequeno">
                  {previa.diferencaCentavos > 0
                    ? `Faltam ${formatarCentavos(previa.diferencaCentavos)}`
                    : `Sobram ${formatarCentavos(-previa.diferencaCentavos)}`}
                </span>
              )}
            </div>
            {previa && previa.trocoTotalCentavos > 0 && (
              <p className="fechamento__troco" role="status">
                Troco: <strong>{formatarCentavos(previa.trocoTotalCentavos)}</strong>
              </p>
            )}
            {(pedeCaixa || !caixaAberto) && (
              <p className="alerta alerta--info">
                Seu caixa está fechado.{' '}
                <button type="button" className="botao-texto" onClick={onAbrirCaixa}>
                  Abrir caixa
                </button>
              </p>
            )}
          </fieldset>
        )}

        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro.texto}{' '}
            {erro.abrirCaixa && (
              <button type="button" className="botao-texto" onClick={onAbrirCaixa}>
                Abrir caixa agora
              </button>
            )}
          </p>
        )}
        <div className="acoes acoes--direita acoes--quebrar">
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => onSessao(null)}
            disabled={enviando}
          >
            Limpar
          </button>
          <button
            type="submit"
            className="botao"
            disabled={enviando || !previa || (aPagar !== null && aPagar > 0 && !podeReceber)}
          >
            {enviando ? 'Registrando…' : `Registrar saída${aPagar ? ` · ${formatarCentavos(aPagar)}` : ''}`}
          </button>
        </div>
      </form>
    </>
  );
}
