import { Fragment, useState } from 'react';
import { centavosParaCampo, formatarCentavos, lerCentavos, type CaixaAtual } from '@estacionamento/shared';
import { caixaApi } from '../../services/sessoes';
import { Dialogo } from '../Dialogo';
import { mensagemDeErro } from '../vagas/Dialogos';
import { horaCurta } from './util';

interface Props {
  caixa: CaixaAtual | null;
  carregando: boolean;
  /** Pedido externo para abrir o diálogo (ex.: saída recusada por caixa fechado). */
  pedirAbertura: boolean;
  onPedidoAtendido: () => void;
  onMudou: (msg: string) => void;
}

/** Situação do caixa do operador logado, com abertura e fechamento. */
export function BarraCaixa({ caixa, carregando, pedirAbertura, onPedidoAtendido, onMudou }: Props) {
  const [dialogo, setDialogo] = useState<'abrir' | 'fechar' | null>(null);
  const aberto = dialogo ?? (pedirAbertura && !caixa ? 'abrir' : null);
  const fechar = () => {
    setDialogo(null);
    onPedidoAtendido();
  };

  return (
    <section className={`barra-caixa${caixa ? ' barra-caixa--aberto' : ''}`} aria-label="Caixa">
      {carregando && !caixa ? (
        <span className="mudo">Verificando o caixa…</span>
      ) : caixa ? (
        <>
          <span className="barra-caixa__estado">
            <span className="situacao__ponto" aria-hidden="true" /> Caixa aberto
          </span>
          <span className="mudo">
            {caixa.posto} · desde {horaCurta(caixa.abertoEm)}
          </span>
          <span>
            Dinheiro na gaveta: <strong>{formatarCentavos(caixa.dinheiroEsperadoCentavos)}</strong>
          </span>
          {caixa.recebidoPorForma
            .filter((f) => f.forma !== 'DINHEIRO' && f.centavos !== 0)
            .map((f) => (
              <span key={f.forma} className="mudo">
                {f.nome}: {formatarCentavos(f.centavos)}
              </span>
            ))}
          <button
            type="button"
            className="botao botao--secundario botao--pequeno"
            onClick={() => setDialogo('fechar')}
          >
            Fechar caixa
          </button>
        </>
      ) : (
        <>
          <span className="barra-caixa__estado">Caixa fechado</span>
          <span className="mudo">Abra o caixa para receber pagamentos.</span>
          <button type="button" className="botao botao--pequeno" onClick={() => setDialogo('abrir')}>
            Abrir caixa
          </button>
        </>
      )}

      {aberto === 'abrir' && (
        <DialogoAbrir
          onFechar={fechar}
          onAberto={(c) => {
            fechar();
            onMudou(`Caixa aberto com ${formatarCentavos(c.saldoInicialCentavos)} de troco.`);
          }}
        />
      )}
      {aberto === 'fechar' && caixa && (
        <DialogoFechar
          caixa={caixa}
          onFechar={fechar}
          onFechado={(msg) => {
            fechar();
            onMudou(msg);
          }}
        />
      )}
    </section>
  );
}

function DialogoAbrir({ onFechar, onAberto }: { onFechar: () => void; onAberto: (c: CaixaAtual) => void }) {
  const [valor, setValor] = useState('0,00');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const centavos = lerCentavos(valor);

  async function abrir() {
    if (centavos === null) return setErro('Informe um valor válido, ex.: 100,00');
    setEnviando(true);
    setErro(null);
    try {
      onAberto(await caixaApi.abrir(centavos));
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo="Abrir caixa"
      textoConfirmar="Abrir caixa"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void abrir()}
    >
      <label className="campo">
        <span>Dinheiro para troco (R$)</span>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          autoFocus
          required
        />
      </label>
    </Dialogo>
  );
}

function DialogoFechar({
  caixa,
  onFechar,
  onFechado,
}: {
  caixa: CaixaAtual;
  onFechar: () => void;
  onFechado: (msg: string) => void;
}) {
  const [contado, setContado] = useState(centavosParaCampo(caixa.dinheiroEsperadoCentavos));
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const centavos = lerCentavos(contado);
  const diferenca = centavos === null ? null : centavos - caixa.dinheiroEsperadoCentavos;

  async function fechar() {
    if (centavos === null) return setErro('Informe o dinheiro contado, ex.: 150,00');
    setEnviando(true);
    setErro(null);
    try {
      const r = await caixaApi.fechar(centavos, observacao.trim() || null);
      onFechado(
        r.diferencaCentavos === 0
          ? 'Caixa fechado. O dinheiro conferiu.'
          : `Caixa fechado com diferença de ${formatarCentavos(r.diferencaCentavos)}.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo="Fechar caixa"
      textoConfirmar="Fechar caixa"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void fechar()}
    >
      <dl className="lista-dados">
        <dt>Aberto às</dt>
        <dd>{horaCurta(caixa.abertoEm)}</dd>
        <dt>Troco inicial</dt>
        <dd>{formatarCentavos(caixa.saldoInicialCentavos)}</dd>
        {caixa.recebidoPorForma.map((f) => (
          <Fragment key={f.forma}>
            <dt>{f.nome}</dt>
            <dd>{formatarCentavos(f.centavos)}</dd>
          </Fragment>
        ))}
        <dt>Dinheiro esperado</dt>
        <dd>
          <strong>{formatarCentavos(caixa.dinheiroEsperadoCentavos)}</strong>
        </dd>
      </dl>
      <label className="campo">
        <span>Dinheiro contado na gaveta (R$)</span>
        <input
          value={contado}
          onChange={(e) => setContado(e.target.value)}
          inputMode="decimal"
          autoFocus
          required
        />
      </label>
      {diferenca !== null && diferenca !== 0 && (
        <p className="alerta alerta--erro" role="status">
          {diferenca > 0 ? 'Sobram' : 'Faltam'} {formatarCentavos(Math.abs(diferenca))} na gaveta. Explique
          abaixo.
        </p>
      )}
      <label className="campo">
        <span>Observação{diferenca ? ' *' : ''}</span>
        <textarea
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          rows={2}
          maxLength={500}
          required={!!diferenca}
        />
      </label>
    </Dialogo>
  );
}
