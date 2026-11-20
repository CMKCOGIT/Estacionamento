import { NavLink, Outlet } from 'react-router';
import { ConviteInstalar } from './ConviteInstalar';
import { useConexao } from './instalacao';

export function Layout({ novaVersao }: { novaVersao: (() => void) | null }) {
  const online = useConexao();
  return (
    <div className="app">
      <header className="topo">
        <NavLink to="/" className="marca" aria-label="Início">
          <img src="/icones/icone.svg" alt="" width={32} height={32} />
          <span>
            Meu <b>Ticket</b>
          </span>
        </NavLink>
      </header>
      {!online && (
        <p className="faixa faixa--offline" role="status">
          Sem internet. Mostrando as últimas informações recebidas.
        </p>
      )}
      {novaVersao && (
        <p className="faixa faixa--novidade" role="status">
          Há uma versão nova do app.{' '}
          <button type="button" className="botao-texto" onClick={novaVersao}>
            Atualizar
          </button>
        </p>
      )}
      <main className="conteudo">
        <Outlet />
      </main>
      <ConviteInstalar />
      <nav className="navegacao" aria-label="Principal">
        <NavLink to="/" end className="navegacao__item">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />
          </svg>
          Vagas e preços
        </NavLink>
        <NavLink to="/ticket" className="navegacao__item">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4z" />
          </svg>
          Meu ticket
        </NavLink>
        <NavLink to="/privacidade" className="navegacao__item">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" />
          </svg>
          Privacidade
        </NavLink>
      </nav>
    </div>
  );
}
