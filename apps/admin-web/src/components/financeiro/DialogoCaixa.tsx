import { useCallback, useEffect, useRef, useState } from 'react';
import { centavosParaCampo, formatarCentavos, lerCentavos, type CaixaDetalhe } from '@estacionamento/shared';
import { useCarregar } from '../../hooks/useCarregar';
import { financeiroApi } from '../../services/financeiro';
import { formatarDataHora } from '../../services/rotulos';
import { horaCurta } from '../operacao/util';
import { mensagemDeErro } from '../vagas/Dialogos';
import { TabelaMovimentacoes } from './Tabelas';

interface Props {
  caixaId: string;
  /** Supervisor pode fechar o caixa de outro operador. */
  podeFechar: boolean;
  onFechar: () => void;
  onMudou: (msg: string) => void;
}

export function ResumoDoCaixa({ c }: { c: CaixaDetalhe | Omit<CaixaDetalhe, 'movimentacoes'> }) {
  return (
    <>
      <dl className="lista-dados">
        <dt>Guichê / operador</dt>
        <dd>
          {c.posto} · {c.operador}
        </dd>
        <dt>Aberto</dt>
        <dd>{formatarDataHora(c.abertoEm)}</dd>
        {c.fechadoEm && (
          <>
            <dt>Fechado</dt>
            <dd>
              {formatarDataHora(c.fechadoEm)}
              {c.fechadoPor && c.fechadoPor !== c.operador ? ` por ${c.fechadoPor}` : ''}
            </dd>
          </>
        )}
        <dt>Troco inicial</dt>
        <dd>{formatarCentavos(c.saldoInicialCentavos)}</dd>
        <dt>Recebimentos</dt>
        <dd>
          {c.quantidadeRecebimentos} · {formatarCentavos(c.recebidoCentavos)}
        </dd>
        {c.estornadoCentavos > 0 && (
          <>
            <dt>Estornos</dt>
            <dd>− {formatarCentavos(c.estornadoCentavos)}</dd>
          </>
        )}
        {(c.suprimentosCentavos > 0 || c.sangriasCentavos > 0) && (
          <>
            <dt>Suprimentos / sangrias</dt>
            <dd>
              + {formatarCentavos(c.suprimentosCentavos)} / − {formatarCentavos(c.sangriasCentavos)}
            </dd>
          </>
        )}
        <dt>Dinheiro esperado</dt>
        <dd>
          <strong>{formatarCentavos(c.dinheiroEsperadoCentavos)}</strong>
        </dd>
        {c.saldoContadoCentavos !== null && (
          <>
            <dt>Contado</dt>
            <dd>
              {formatarCentavos(c.saldoContadoCentavos)}
              {c.diferencaCentavos ? (
                <span className="erro">
                  {' '}
                  ({c.diferencaCentavos > 0 ? 'sobra' : 'falta'} de{' '}
                  {formatarCentavos(Math.abs(c.diferencaCentavos))})
                </span>
              ) : (
                <span className="mudo"> (conferiu)</span>
              )}
            </dd>
          </>
        )}
        {c.observacao && (
          <>
            <dt>Observação</dt>
            <dd>{c.observacao}</dd>
          </>
        )}
      </dl>
      {c.porForma.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th scope="col">Forma</th>
                <th scope="col" className="numero">
                  Entradas
                </th>
                <th scope="col" className="numero">
                  Saídas
                </th>
                <th scope="col" className="numero">
                  Saldo
                </th>
              </tr>
            </thead>
            <tbody>
              {c.porForma.map((f) => (
                <tr key={f.forma}>
                  <td>{f.nome}</td>
                  <td className="numero">{formatarCentavos(f.entradasCentavos)}</td>
                  <td className="numero">{formatarCentavos(f.saidasCentavos)}</td>
                  <td className="numero">
                    <strong>{formatarCentavos(f.saldoCentavos)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Detalhe de um caixa: resumo, movimentações e (supervisor) fechamento. */
export function DialogoCaixa({ caixaId, podeFechar, onFechar, onMudou }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const carregar = useCallback(() => financeiroApi.caixa(caixaId), [caixaId]);
  const { dados: c, erro, recarregar } = useCarregar(carregar);
  const [fechando, setFechando] = useState(false);
  const [contado, setContado] = useState('');
  const [obs, setObs] = useState('');
  const [erroFechar, setErroFechar] = useState<string | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function fechar() {
    const centavos = lerCentavos(contado);
    if (centavos === null) return setErroFechar('Informe o dinheiro contado, ex.: 150,00');
    try {
      const r = await financeiroApi.fecharCaixa(caixaId, centavos, obs.trim() || null);
      onMudou(
        r.diferencaCentavos === 0
          ? 'Caixa fechado. O dinheiro conferiu.'
          : `Caixa fechado com diferença de ${formatarCentavos(r.diferencaCentavos)}.`,
      );
      setFechando(false);
      recarregar();
    } catch (e) {
      setErroFechar(mensagemDeErro(e));
    }
  }

  return (
    <dialog ref={ref} className="dialogo dialogo--largo" onClose={onFechar} aria-labelledby="caixa-titulo">
      <h2 id="caixa-titulo">
        Caixa {c ? `· ${c.posto} · ${horaCurta(c.abertoEm)}` : ''}{' '}
        {c && (
          <span className={`etiqueta ${c.status === 'ABERTO' ? 'etiqueta--ativo' : 'etiqueta--inativo'}`}>
            {c.status === 'ABERTO' ? 'Aberto' : 'Fechado'}
          </span>
        )}
      </h2>
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {c && (
        <>
          <ResumoDoCaixa c={c} />
          <h3 className="pequeno">Movimentações</h3>
          <TabelaMovimentacoes itens={c.movimentacoes} semCaixa />
          {podeFechar && c.status === 'ABERTO' && !fechando && (
            <button
              type="button"
              className="botao botao--secundario"
              onClick={() => {
                setContado(centavosParaCampo(c.dinheiroEsperadoCentavos));
                setFechando(true);
              }}
            >
              Fechar este caixa (supervisor)
            </button>
          )}
          {fechando && (
            <form
              className="cartao"
              onSubmit={(e) => {
                e.preventDefault();
                void fechar();
              }}
            >
              <p className="pequeno mudo">Conte o dinheiro da gaveta. Havendo diferença, explique.</p>
              <div className="grade-campos grade-campos--estreita">
                <label className="campo">
                  <span>Dinheiro contado (R$)</span>
                  <input
                    value={contado}
                    onChange={(e) => setContado(e.target.value)}
                    inputMode="decimal"
                    required
                  />
                </label>
                <label className="campo">
                  <span>Observação</span>
                  <input value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} />
                </label>
              </div>
              {erroFechar && <p className="alerta alerta--erro">{erroFechar}</p>}
              <div className="acoes">
                <button type="submit" className="botao">
                  Confirmar fechamento
                </button>
                <button type="button" className="botao botao--secundario" onClick={() => setFechando(false)}>
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </>
      )}
      <div className="acoes acoes--direita">
        <button type="button" className="botao" onClick={() => ref.current?.close()} autoFocus>
          Fechar
        </button>
      </div>
    </dialog>
  );
}
