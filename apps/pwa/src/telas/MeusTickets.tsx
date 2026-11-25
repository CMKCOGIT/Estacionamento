import { useState } from 'react';
import { Link } from 'react-router';
import { esquecer, removerEncerrados } from '../armazenamento';
import { InstalarApp } from '../componentes/InstalarApp';
import { CartaoTicket } from './CartaoTicket';

/** Os tickets guardados neste celular (cada um aberto pelo próprio link). */
export function MeusTickets() {
  // Política de encerramento: tickets com acesso vencido saem do celular ao abrir a tela
  const [inicial] = useState(() => removerEncerrados());
  const [tickets, setTickets] = useState(inicial.lista);
  const aviso = inicial.removidos > 0 && (
    <p className="alerta alerta--info" role="status">
      {inicial.removidos === 1
        ? 'Um ticket encerrado foi removido deste celular: o prazo de acesso depois da saída terminou.'
        : `${inicial.removidos} tickets encerrados foram removidos deste celular: o prazo de acesso depois da saída terminou.`}
    </p>
  );
  if (!tickets.length) {
    return (
      <section className="cartao vazio">
        {aviso}
        <h1>Meu ticket</h1>
        <p>
          Leia o <b>QR Code</b> mostrado no caixa ou abra o <b>link</b> que você recebeu na entrada. O seu
          ticket aparece aqui e fica guardado neste celular.
        </p>
        <p className="mudo pequeno">
          Por segurança, cada link mostra só o próprio ticket. Ninguém consegue ver o seu sem ele.
        </p>
        <Link to="/" className="botao botao--secundario">
          Ver vagas e preços
        </Link>
      </section>
    );
  }
  return (
    <>
      <h1 className="titulo-tela">{tickets.length > 1 ? 'Meus tickets' : 'Meu ticket'}</h1>
      {aviso}
      {tickets.map((t) => (
        <CartaoTicket key={t.token} salvo={t} onEsquecer={() => setTickets(esquecer(t.token))} />
      ))}
      <InstalarApp />
    </>
  );
}
