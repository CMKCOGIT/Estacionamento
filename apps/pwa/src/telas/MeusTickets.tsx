import { useCallback, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { esquecer, lerTickets, removerEncerrados } from '../armazenamento';
import { LerQrCode } from '../componentes/LerQrCode';
import { InstalarApp } from '../componentes/InstalarApp';
import { CartaoTicket } from './CartaoTicket';

/** Os tickets guardados neste celular (cada um aberto pelo próprio link). */
export function MeusTickets() {
  // Política de encerramento: tickets com acesso vencido saem do celular ao abrir a tela
  const [inicial] = useState(() => removerEncerrados());
  const [tickets, setTickets] = useState(inicial.lista);
  const [params, setParams] = useSearchParams();
  const lendo = params.get('ler') === '1';
  const setLendo = useCallback(
    (v: boolean) => setParams(v ? { ler: '1' } : {}, { replace: true }),
    [setParams],
  );
  const aoLer = useCallback(() => {
    setTickets(lerTickets());
    setLendo(false);
  }, [setLendo]);
  const leitor = lendo ? (
    <LerQrCode onLido={aoLer} onFechar={() => setLendo(false)} />
  ) : (
    <button type="button" className="botao botao-ler" onClick={() => setLendo(true)}>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        width={20}
        height={20}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
      >
        <path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" />
      </svg>
      Ler QR Code do ticket
    </button>
  );
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
        {leitor}
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
      {leitor}
      <InstalarApp />
    </>
  );
}
