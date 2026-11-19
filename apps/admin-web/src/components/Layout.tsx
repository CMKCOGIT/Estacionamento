import type { ReactNode } from 'react';

/** Itens do menu. `pronto: false` = módulo previsto, ainda não implementado. */
const MENU = [
  { rotulo: 'Início', pronto: true },
  { rotulo: 'Entrada e saída', pronto: false },
  { rotulo: 'Vagas', pronto: false },
  { rotulo: 'Caixa', pronto: false },
  { rotulo: 'Tarifas', pronto: false },
  { rotulo: 'Relatórios', pronto: false },
  { rotulo: 'Usuários', pronto: false },
  { rotulo: 'Configurações', pronto: false },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="layout">
      <aside className="layout__menu">
        <div className="marca">
          <span className="marca__logo">P</span>
          <span>Estacionamento</span>
        </div>
        <nav>
          {MENU.map((item) => (
            <button
              key={item.rotulo}
              type="button"
              className={`menu__item${item.rotulo === 'Início' ? ' menu__item--ativo' : ''}`}
              disabled={!item.pronto}
              title={item.pronto ? undefined : 'Em breve'}
            >
              {item.rotulo}
            </button>
          ))}
        </nav>
      </aside>
      <main className="layout__conteudo">{children}</main>
    </div>
  );
}
