import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';

interface Props {
  aberto: boolean;
  titulo: string;
  children: ReactNode;
  textoConfirmar: string;
  perigo?: boolean;
  /** Formulários grandes: diálogo mais largo. */
  largo?: boolean;
  enviando?: boolean;
  erro?: string | null;
  onConfirmar: () => void;
  onFechar: () => void;
}

/** Diálogo modal nativo (<dialog>): foco preso, Esc fecha, acessível por teclado. */
export function Dialogo({
  aberto,
  titulo,
  children,
  textoConfirmar,
  perigo,
  largo,
  enviando,
  erro,
  onConfirmar,
  onFechar,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    onConfirmar();
  };

  return (
    <dialog
      ref={ref}
      className={`dialogo${largo ? ' dialogo--largo' : ''}`}
      onClose={onFechar}
      aria-labelledby="dialogo-titulo"
    >
      <form onSubmit={enviar}>
        <h2 id="dialogo-titulo">{titulo}</h2>
        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}
        {children}
        <div className="acoes acoes--direita">
          <button type="button" className="botao botao--secundario" onClick={onFechar} disabled={enviando}>
            Cancelar
          </button>
          <button type="submit" className={`botao${perigo ? ' botao--perigo' : ''}`} disabled={enviando}>
            {enviando ? 'Aguarde…' : textoConfirmar}
          </button>
        </div>
      </form>
    </dialog>
  );
}
