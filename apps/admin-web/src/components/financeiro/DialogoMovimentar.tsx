import { useState } from 'react';
import { formatarCentavos, lerCentavos } from '@estacionamento/shared';
import { financeiroApi } from '../../services/financeiro';
import { Dialogo } from '../Dialogo';
import { mensagemDeErro } from '../vagas/Dialogos';

interface Props {
  tipo: 'SANGRIA' | 'SUPRIMENTO';
  onFechar: () => void;
  onFeito: (msg: string) => void;
}

/** Sangria (tirar dinheiro da gaveta) ou suprimento (colocar troco) no caixa aberto. */
export function DialogoMovimentar({ tipo, onFechar, onFeito }: Props) {
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState(tipo === 'SANGRIA' ? 'Depósito no cofre' : 'Reforço de troco');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar() {
    const centavos = lerCentavos(valor);
    if (!centavos) return setErro('Informe o valor, ex.: 100,00');
    setEnviando(true);
    setErro(null);
    try {
      await financeiroApi.movimentarCaixa({ tipo, valorCentavos: centavos, descricao: descricao.trim() });
      onFeito(
        tipo === 'SANGRIA'
          ? `Sangria de ${formatarCentavos(centavos)} registrada.`
          : `Suprimento de ${formatarCentavos(centavos)} registrado.`,
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
      titulo={tipo === 'SANGRIA' ? 'Sangria (retirar dinheiro)' : 'Suprimento (colocar troco)'}
      textoConfirmar="Registrar"
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void enviar()}
    >
      <label className="campo">
        <span>Valor (R$)</span>
        <input
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          autoFocus
          required
        />
      </label>
      <label className="campo">
        <span>Motivo *</span>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          minLength={3}
          maxLength={255}
          required
        />
      </label>
    </Dialogo>
  );
}
