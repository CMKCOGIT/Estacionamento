import { useEffect, useState, type FormEvent } from 'react';
import {
  centavosParaCampo,
  formatarCentavos,
  lerCentavos,
  type FormaPagamento,
  type ReciboSaida,
  type SessaoDetalhe,
} from '@estacionamento/shared';
import { ErroDaApi } from '../../services/api';
import { formatarDataHora } from '../../services/rotulos';
import { sessoesApi } from '../../services/sessoes';
import { Placa } from '../Placa';
import { duracaoCurta } from '../vagas/MapaVagas';
import { mensagemDeErro } from '../vagas/Dialogos';
import { novoUuid } from './util';

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
  const c = sessao.calculo;
  const formaPadrao = formas[0]?.codigo ?? 'DINHEIRO';
  const [linhas, setLinhas] = useState<Linha[]>(() => [novaLinha(formaPadrao, null)]);
  const [desconto, setDesconto] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<{ texto: string; abrirCaixa?: boolean } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const descontoCentavos = desconto.trim() ? lerCentavos(desconto) : 0;
  const aPagar = Math.max(0, c.aPagarCentavos - (descontoCentavos ?? 0));
  const somaFixas = linhas.reduce((t, l) => (l.valor === null ? t : t + (lerCentavos(l.valor) ?? 0)), 0);
  const restante = Math.max(0, aPagar - somaFixas);
  const valores = linhas.map((l) => (l.valor === null ? restante : lerCentavos(l.valor)));
  const soma = valores.reduce<number>((t, v) => t + (v ?? 0), 0);
  const falta = aPagar - soma;

  // O tempo corre: recalcula a cada 30 s. Se o valor mudar, refaz o pagamento.
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      sessoesApi
        .obter(sessao.id)
        .then((s) => {
          if (s.status !== 'ABERTA') return onSessao(null);
          if (s.calculo.valorCalculadoCentavos !== sessao.calculo.valorCalculadoCentavos) {
            setAviso(
              `O valor passou de ${formatarCentavos(sessao.calculo.valorCalculadoCentavos)} para ${formatarCentavos(s.calculo.valorCalculadoCentavos)} (mudou a fração de tempo).`,
            );
          }
          onSessao(s);
        })
        .catch(() => undefined);
    }, 30_000);
    return () => clearInterval(t);
  }, [sessao, onSessao]);

  const formaDe = (codigo: string) => formas.find((f) => f.codigo === codigo);
  const troco = linhas.reduce((t, l, i) => {
    const recebido = formaDe(l.forma)?.permiteTroco && l.recebido.trim() ? lerCentavos(l.recebido) : null;
    return recebido !== null && valores[i] !== null ? t + Math.max(0, recebido - valores[i]!) : t;
  }, 0);

  const mudar = (i: number, campo: keyof Linha, valor: string) =>
    setLinhas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: valor } : l)));

  async function confirmar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (descontoCentavos === null) return setErro({ texto: 'Desconto inválido.' });
    if (descontoCentavos > 0 && motivo.trim().length < 3)
      return setErro({ texto: 'Informe o motivo do desconto.' });
    if (aPagar > 0 && (valores.some((v) => v === null || v <= 0) || falta !== 0)) {
      return setErro({
        texto: `Os pagamentos somam ${formatarCentavos(soma)}, mas o valor a pagar é ${formatarCentavos(aPagar)}.`,
      });
    }
    setEnviando(true);
    try {
      const recibo = await sessoesApi.saida(sessao.id, {
        valorEsperadoCentavos: c.valorCalculadoCentavos,
        descontoCentavos: descontoCentavos || 0,
        motivoAjuste: descontoCentavos ? motivo.trim() : null,
        pagamentos:
          aPagar > 0
            ? linhas.map((l, i) => {
                const f = formaDe(l.forma);
                return {
                  forma: l.forma,
                  valorCentavos: valores[i]!,
                  valorRecebidoCentavos:
                    f?.permiteTroco && l.recebido.trim() ? lerCentavos(l.recebido) : null,
                  chaveIdempotencia: l.chave,
                };
              })
            : [],
      });
      onSaiu(recibo);
    } catch (falha) {
      if (falha instanceof ErroDaApi && !Array.isArray(falha.corpo.detalhes)) {
        const d = falha.corpo.detalhes;
        if (d?.acao === 'ABRIR_CAIXA') return setErro({ texto: falha.message, abrirCaixa: true });
        if (typeof d?.valorCalculadoCentavos === 'number') {
          setAviso(falha.message);
          onSessao(await sessoesApi.obter(sessao.id));
          return;
        }
      }
      setErro({ texto: mensagemDeErro(falha) });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form className="fechamento" onSubmit={confirmar}>
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
        <dd>{c.tarifa}</dd>
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
        <strong>{formatarCentavos(aPagar)}</strong>
      </p>

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
            const recebido = f?.permiteTroco && l.recebido.trim() ? lerCentavos(l.recebido) : null;
            const trocoLinha = recebido !== null && valores[i] !== null ? recebido - valores[i]! : null;
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
                    value={l.valor ?? centavosParaCampo(restante)}
                    onChange={(e) => mudar(i, 'valor', e.target.value)}
                    inputMode="decimal"
                    required
                  />
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
                {trocoLinha !== null && trocoLinha < 0 && (
                  <p className="pequeno erro pagamento__aviso">Recebido menor que o valor.</p>
                )}
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
            {falta !== 0 && (
              <span className="erro pequeno">
                {falta > 0 ? `Faltam ${formatarCentavos(falta)}` : `Sobram ${formatarCentavos(-falta)}`}
              </span>
            )}
          </div>
          {troco > 0 && (
            <p className="fechamento__troco" role="status">
              Troco: <strong>{formatarCentavos(troco)}</strong>
            </p>
          )}
          {!caixaAberto && (
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
        <button type="submit" className="botao" disabled={enviando || (aPagar > 0 && !podeReceber)}>
          {enviando ? 'Registrando…' : `Registrar saída${aPagar > 0 ? ` · ${formatarCentavos(aPagar)}` : ''}`}
        </button>
      </div>
    </form>
  );
}
