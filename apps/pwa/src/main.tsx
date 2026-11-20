import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { registrarServiceWorker } from './registroSw';
import './estilos.css';

let avisar: ((ativar: () => void) => void) | null = null;
let pendente: (() => void) | null = null;
registrarServiceWorker((ativar) => (avisar ? avisar(ativar) : (pendente = ativar)));

function Raiz() {
  const [novaVersao, setNovaVersao] = useState<(() => void) | null>(() => pendente);
  useEffect(() => {
    avisar = (ativar) => setNovaVersao(() => ativar);
  }, []);
  return <App novaVersao={novaVersao} />;
}

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <Raiz />
  </StrictMode>,
);
