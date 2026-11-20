import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router';
import { salvarToken } from '../armazenamento';
import { tokenDoLink } from '../token';

/**
 * Link do ticket: `/t#<token>`. Guarda o token neste celular e tira o `#` da
 * barra de endereço (assim ele não vai junto num print ou num "copiar link").
 */
export function AbrirLink() {
  const [token] = useState(() => tokenDoLink(window.location.hash));
  useEffect(() => {
    if (token) salvarToken(token);
  }, [token]);
  if (token) return <Navigate to="/ticket" replace />;
  return (
    <section className="cartao vazio">
      <h1>Link incompleto</h1>
      <p>Este link de ticket não está completo. Leia de novo o QR Code no caixa ou peça um novo link.</p>
      <Link to="/ticket" className="botao botao--secundario">
        Meus tickets
      </Link>
    </section>
  );
}
