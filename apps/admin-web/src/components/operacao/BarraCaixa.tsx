import { useState } from 'react';
import {
  formatarCentavos,
  lerCentavos,
  type CaixaAtual,
  type ResultadoFechamentoCaixa,
} from '@estacionamento/shared';
import { formatarDataHora } from '../../services/rotulos';
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
          {caixa.dinheiroEsperadoCentavos !== null && (
            <span>
              Dinheiro na gaveta: <strong>{formatarCentavos(caixa.dinheiroEsperadoCentavos)}</strong>
            </span>
          )}
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

/**
 * Fechamento às cegas: o funcionário conta e informa o total, confirma, e só
 * então o servidor compara com o esperado. Operador não vê o esperado nem a
 * diferença (nem antes, nem depois): isso fica para o gerente/administrador.
 */
function DialogoFechar({
  caixa,
  onFechar,
  onFechado,
}: {
  caixa: CaixaAtual;
  onFechar: () => void;
  onFechado: (msg: string) => void;
}) {
  const [etapa, setEtapa] = useState<'contar' | 'confirmar' | 'pronto'>('contar');
  const [contado, setContado] = useState('');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoFechamentoCaixa | null>(null);
  const centavos = lerCentavos(contado);

  async function avancar() {
    setErro(null);
    if (etapa === 'contar') {
      if (centavos === null || !contado.trim()) return setErro('Informe o total contado, ex.: 150,00');
      setEtapa('confirmar');
      return;
    }
    if (etapa === 'pronto') {
      onFechado(
        resultado?.conferenciaOculta
          ? 'Caixa fechado. O valor informado foi registrado para conferência.'
          : resultado?.diferencaCentavos === 0
            ? 'Caixa fechado. O dinheiro conferiu.'
            : `Caixa fechado com diferença de ${formatarCentavos(resultado?.diferencaCentavos ?? 0)}.`,
      );
      return;
    }
    setEnviando(true);
    try {
      setResultado(await caixaApi.fechar(centavos!, observacao.trim() || null));
      setEtapa('pronto');
    } catch (e) {
      setErro(mensagemDeErro(e));
      setEtapa('contar');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={etapa === 'pronto' ? 'Caixa fechado' : 'Fechar caixa'}
      textoConfirmar={
        etapa === 'contar' ? 'Continuar' : etapa === 'confirmar' ? 'Confirmar fechamento' : 'Concluir'
      }
      perigo={etapa === 'confirmar'}
      enviando={enviando}
      erro={erro}
      onFechar={() => (etapa === 'pronto' ? void avancar() : onFechar())}
      onConfirmar={() => void avancar()}
    >
      {etapa === 'contar' && (
        <>
          <dl className="lista-dados">
            <dt>Caixa</dt>
            <dd>
              {caixa.posto} · aberto às {horaCurta(caixa.abertoEm)}
            </dd>
            <dt>Troco inicial</dt>
            <dd>{formatarCentavos(caixa.saldoInicialCentavos)}</dd>
          </dl>
          <p className="mudo pequeno">
            Conte todo o dinheiro da gaveta (incluindo o troco inicial) e informe o total encontrado.
          </p>
          <label className="campo">
            <span>Total contado na gaveta (R$)</span>
            <input
              value={contado}
              onChange={(e) => setContado(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
              autoFocus
              required
            />
          </label>
          <label className="campo">
            <span>Observação (opcional)</span>
            <textarea
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </label>
        </>
      )}
      {etapa === 'confirmar' && (
        <>
          <p>
            Você vai fechar o caixa <strong>{caixa.posto}</strong> informando{' '}
            <strong>{formatarCentavos(centavos ?? 0)}</strong> contados na gaveta.
          </p>
          <p className="alerta alerta--info">
            Depois de confirmar, o valor não pode ser alterado. Se houver erro, o gerente registra uma
            correção.
          </p>
        </>
      )}
      {etapa === 'pronto' && resultado && (
        <dl className="lista-dados">
          <dt>Caixa</dt>
          <dd>{resultado.posto}</dd>
          <dt>Turno</dt>
          <dd>
            {formatarDataHora(resultado.abertoEm)} → {horaCurta(resultado.fechadoEm)}
          </dd>
          <dt>Valor informado</dt>
          <dd>
            <strong>{formatarCentavos(resultado.contadoCentavos)}</strong>
          </dd>
          {resultado.conferenciaOculta ? (
            <>
              <dt>Conferência</dt>
              <dd>Registrada. O resultado fica disponível para o gerente.</dd>
            </>
          ) : (
            <>
              <dt>Esperado pelo sistema</dt>
              <dd>{formatarCentavos(resultado.esperadoCentavos ?? 0)}</dd>
              <dt>Diferença</dt>
              <dd className={resultado.diferencaCentavos ? 'erro' : undefined}>
                {resultado.diferencaCentavos === 0
                  ? 'Nenhuma: conferiu'
                  : `${(resultado.diferencaCentavos ?? 0) > 0 ? 'Sobra' : 'Falta'} de ${formatarCentavos(Math.abs(resultado.diferencaCentavos ?? 0))}`}
              </dd>
            </>
          )}
        </dl>
      )}
    </Dialogo>
  );
}
