import { useState } from 'react';
import { useInstalacao } from './instalacao';

/**
 * "Instalar app" no fim do ticket. Android/Chrome: abre a instalação do
 * navegador. iPhone e navegadores sem esse recurso: mostra o passo a passo.
 * Some quando o app já está instalado (aberto pela tela inicial).
 */
export function InstalarApp() {
  const { instalado, podeInstalar, ios, instalar } = useInstalacao();
  const [ajuda, setAjuda] = useState(false);
  if (instalado) return null;
  return (
    <section className="cartao instalar" aria-label="Instalar o app">
      <div className="instalar__topo">
        <img src="/icones/icone-192.png" alt="" width={48} height={48} />
        <div>
          <strong>Instale o app Meu Ticket</strong>
          <p className="mudo pequeno">Acompanhe o tempo e o valor com um toque, direto da tela inicial.</p>
        </div>
      </div>
      <button
        type="button"
        className="botao instalar__botao"
        aria-expanded={podeInstalar ? undefined : ajuda}
        onClick={() => (podeInstalar ? void instalar() : setAjuda(!ajuda))}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width={20} height={20}>
          <path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
        </svg>
        Instalar app
      </button>
      {ajuda && !podeInstalar && (
        <ol className="instalar__passos">
          {ios ? (
            <>
              <li>
                Toque em <b>Compartilhar</b> (o quadrado com a seta para cima, na barra do Safari).
              </li>
              <li>
                Role e toque em <b>Adicionar à Tela de Início</b>.
              </li>
              <li>
                Toque em <b>Adicionar</b>.
              </li>
              <li className="mudo">
                No iPhone, o app instalado não recebe o ticket aberto no Safari: abra o app e toque em{' '}
                <b>Ler QR Code do ticket</b>.
              </li>
            </>
          ) : (
            <>
              <li>
                Abra o menu do navegador (<b>⋮</b> no canto de cima).
              </li>
              <li>
                Toque em <b>Instalar app</b> ou <b>Adicionar à tela inicial</b>.
              </li>
            </>
          )}
        </ol>
      )}
    </section>
  );
}
