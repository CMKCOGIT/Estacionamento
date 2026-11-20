import { useRef, useState } from 'react';
import {
  formatarCentavos,
  lerCentavos,
  type FormaPagamento,
  type Pendencia,
  type ResultadoPagamento,
} from '@estacionamento/shared';
import { ErroDaApi } from '../../services/api';
import { financeiroApi } from '../../services/financeiro';
import { Dialogo } from '../Dialogo';
import { novoUuid } from '../operacao/util';
import { mensagemDeErro } from '../vagas/Dialogos';

interface Props {
  pendencia: Pendencia;
  formas: FormaPagamento[];
  onFechar: () => void;
  onRecebido: (r: ResultadoPagamento) => void;
  onAbrirCaixa: () => void;
}

/**
 * Recebe um pagamento com o veículo ainda no estacionamento. A chave de
 * idempotência é criada uma vez por diálogo: clicar duas vezes ou repetir
 * após uma falha de rede nunca registra o pagamento em dobro.
 */
export function DialogoReceber({ pendencia, formas, onFechar, onRecebido, onAbrirCaixa }: Props) {
  const chave = useRef(novoUuid());
  const [forma, setForma] = useState(formas[0]?.codigo ?? 'DINHEIRO');
  const [valor, setValor] = useState('');
  const [recebido, setRecebido] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [duplicidade, setDuplicidade] = useState<string | null>(null);
  const [pedeCaixa, setPedeCaixa] = useState(false);
  const permiteTroco = formas.find((f) => f.codigo === forma)?.permiteTroco ?? false;

  async function enviar(confirmarDuplicidade = false) {
    const valorCentavos = valor.trim() ? lerCentavos(valor) : null;
    const recebidoCentavos = permiteTroco && recebido.trim() ? lerCentavos(recebido) : null;
    if (valor.trim() && valorCentavos === null) return setErro('Valor inválido. Use o formato 10,00.');
    if (recebido.trim() && recebidoCentavos === null) return setErro('Valor recebido inválido.');
    setEnviando(true);
    setErro(null);
    try {
      onRecebido(
        await financeiroApi.receber(pendencia.sessaoId, {
          forma,
          valorCentavos,
          valorRecebidoCentavos: recebidoCentavos,
          chaveIdempotencia: chave.current,
          confirmarDuplicidade,
        }),
      );
    } catch (e) {
      if (e instanceof ErroDaApi && !Array.isArray(e.corpo.detalhes)) {
        if (e.corpo.detalhes?.motivo === 'POSSIVEL_DUPLICIDADE') {
          setDuplicidade(e.message);
          return;
        }
        if (e.corpo.detalhes?.acao === 'ABRIR_CAIXA') setPedeCaixa(true);
      }
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`Receber · ticket nº ${pendencia.numero}`}
      textoConfirmar={duplicidade ? 'É outro pagamento: registrar' : 'Registrar pagamento'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void enviar(!!duplicidade)}
    >
      <p>
        Placa <strong>{pendencia.placa}</strong> · em aberto agora{' '}
        <strong>{formatarCentavos(pendencia.aPagarCentavos)}</strong>
        {pendencia.pagoCentavos > 0 && (
          <span className="mudo"> (já pagou {formatarCentavos(pendencia.pagoCentavos)})</span>
        )}
      </p>
      <p className="pequeno mudo">
        O veículo continua no estacionamento. Na saída, cobra-se só o que tiver acumulado depois deste
        pagamento.
      </p>
      {duplicidade && (
        <p className="alerta alerta--erro" role="alert">
          {duplicidade}
        </p>
      )}
      {pedeCaixa && (
        <p className="alerta alerta--info">
          <button type="button" className="botao-texto" onClick={onAbrirCaixa}>
            Abrir meu caixa
          </button>
        </p>
      )}
      <div className="grade-campos grade-campos--estreita">
        <label className="campo">
          <span>Forma</span>
          <select
            value={forma}
            onChange={(e) => {
              setForma(e.target.value);
              setDuplicidade(null);
            }}
          >
            {formas.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="campo">
          <span>Valor (R$)</span>
          <input
            value={valor}
            onChange={(e) => {
              setValor(e.target.value);
              setDuplicidade(null);
            }}
            inputMode="decimal"
            placeholder="Todo o valor em aberto"
          />
        </label>
        {permiteTroco && (
          <label className="campo">
            <span>Recebido (R$)</span>
            <input
              value={recebido}
              onChange={(e) => setRecebido(e.target.value)}
              inputMode="decimal"
              placeholder="Para o troco"
            />
          </label>
        )}
      </div>
    </Dialogo>
  );
}
