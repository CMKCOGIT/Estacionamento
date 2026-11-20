import { useState } from 'react';
import { useInstalacao } from './instalacao';

/** Convite discreto para pôr o app na tela inicial (some depois de instalado ou dispensado). */
export function ConviteInstalar() {
  const { instalado, podeInstalar, ios, instalar } = useInstalacao();
  const [dispensado, setDispensado] = useState(() => {
    try {
      return localStorage.getItem('meu-ticket:convite') === 'dispensado';
    } catch {
      return false;
    }
  });
  if (instalado || dispensado || (!podeInstalar && !ios)) return null;
  const dispensar = () => {
    setDispensado(true);
    try {
      localStorage.setItem('meu-ticket:convite', 'dispensado');
    } catch {
      // sem armazenamento
    }
  };
  return (
    <aside className="convite" aria-label="Instalar o app">
      <img src="/icones/icone-192.png" alt="" width={44} height={44} />
      <div className="convite__texto">
        <strong>Tenha o seu ticket a um toque</strong>
        {ios ? (
          <span>
            Toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.
          </span>
        ) : (
          <span>Instale o app na tela inicial. Não ocupa quase nada.</span>
        )}
      </div>
      {!ios && (
        <button type="button" className="botao botao--pequeno" onClick={() => void instalar()}>
          Instalar
        </button>
      )}
      <button type="button" className="convite__fechar" onClick={dispensar} aria-label="Agora não">
        ×
      </button>
    </aside>
  );
}
