import { useEffect, useRef, useState, type ComponentType } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/contexto';
import {
  IconeCalendario,
  IconeCarro,
  IconeDinheiro,
  IconeEngrenagem,
  IconePainel,
  IconeRelatorio,
  IconeRelogio,
  IconeSair,
  IconeSeta,
  IconeUsuario,
  IconeVagas,
} from './Icones';

/**
 * Menu lateral. `permissoes`: o item só aparece para quem tem UMA delas.
 * Os grupos se abrem e fecham; o grupo da página atual abre sozinho.
 */
interface Item {
  rotulo: string;
  rota: string;
  permissoes: string[];
}
interface Grupo {
  id: string;
  rotulo: string;
  icone: ComponentType<{ tamanho?: number }>;
  itens: Item[];
}

export const PERMISSOES_VAGAS = [
  'vaga.gerenciar',
  'vaga.capacidade',
  'sessao.consultar',
  'sessao.entrada',
  'relatorio.operacional',
];

const GRUPOS: Grupo[] = [
  {
    id: 'operacao',
    rotulo: 'Operação',
    icone: IconeCarro,
    itens: [
      { rotulo: 'Entrada e saída', rota: '/operacao', permissoes: ['sessao.entrada', 'sessao.saida'] },
      {
        rotulo: 'Veículos',
        rota: '/veiculos',
        permissoes: [
          'veiculo.gerenciar',
          'sessao.consultar',
          'sessao.entrada',
          'sessao.saida',
          'relatorio.operacional',
        ],
      },
    ],
  },
  {
    id: 'financeiro',
    rotulo: 'Financeiro',
    icone: IconeDinheiro,
    itens: [
      {
        rotulo: 'Caixa',
        rota: '/caixa',
        permissoes: ['caixa.operar', 'caixa.supervisionar', 'relatorio.financeiro', 'pagamento.registrar'],
      },
      {
        rotulo: 'Tarifas',
        rota: '/tarifas',
        permissoes: ['tarifa.ver', 'tarifa.gerenciar', 'tarifa.publicar'],
      },
    ],
  },
  {
    id: 'relatorios',
    rotulo: 'Relatórios',
    icone: IconeRelatorio,
    itens: [
      {
        rotulo: 'Administrativos',
        rota: '/relatorios-administrativos',
        permissoes: ['relatorio.operacional'],
      },
      {
        rotulo: 'Financeiros',
        rota: '/relatorios',
        permissoes: ['relatorio.financeiro', 'caixa.supervisionar'],
      },
    ],
  },
  {
    id: 'administracao',
    rotulo: 'Administração',
    icone: IconeEngrenagem,
    itens: [
      {
        rotulo: 'Funcionários',
        rota: '/usuarios',
        permissoes: ['usuario.gerenciar', 'funcionario.gerenciar'],
      },
      { rotulo: 'Atividades', rota: '/atividades', permissoes: ['auditoria.ver'] },
      { rotulo: 'Monitoramento', rota: '/monitoramento', permissoes: ['sistema.monitorar'] },
      { rotulo: 'Backups', rota: '/backups', permissoes: ['backup.gerenciar'] },
      { rotulo: 'Privacidade (LGPD)', rota: '/privacidade', permissoes: ['lgpd.atender'] },
      { rotulo: 'Configurações', rota: '/configuracoes', permissoes: ['config.gerenciar'] },
    ],
  },
];

const CHAVE_GRUPOS = 'menu-grupos-abertos';
function lerAbertos(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) ?? '[]') as string[];
  } catch {
    return [];
  }
}

const ativa = (rota: string, caminho: string) => caminho === rota || caminho.startsWith(`${rota}/`);

export function Layout() {
  const { usuario, sair, temPermissao } = useAuth();
  const navegar = useNavigate();
  const { pathname } = useLocation();
  const [abertos, setAbertos] = useState<string[]>(lerAbertos);
  // Celular: menu recolhido; fecha sozinho ao trocar de página
  const [menuAberto, setMenuAberto] = useState(false);
  const [caminhoAnterior, setCaminhoAnterior] = useState(pathname);
  if (caminhoAnterior !== pathname) {
    setCaminhoAnterior(pathname);
    setMenuAberto(false);
  }

  const grupos = GRUPOS.map((g) => ({
    ...g,
    itens: g.itens.filter((i) => temPermissao(...i.permissoes)),
  })).filter((g) => g.itens.length > 0);
  const grupoAtual = grupos.find((g) => g.itens.some((i) => ativa(i.rota, pathname)))?.id;

  function alternar(id: string) {
    const aberto = abertos.includes(id) || id === grupoAtual;
    const novos = aberto ? abertos.filter((x) => x !== id) : [...abertos, id];
    setAbertos(novos);
    try {
      localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(novos));
    } catch {
      /* sem armazenamento: só não lembra */
    }
  }

  async function aoSair() {
    await sair();
    navegar('/login', { replace: true });
  }

  return (
    <div className="layout">
      <aside className={`layout__menu${menuAberto ? ' layout__menu--aberto' : ''}`}>
        <div className="marca">
          <span className="marca__logo" aria-hidden="true">
            P
          </span>
          <span className="marca__nome">
            Estaciona<strong>mento</strong>
          </span>
          <button
            type="button"
            className="menu-alternar"
            aria-expanded={menuAberto}
            onClick={() => setMenuAberto(!menuAberto)}
          >
            {menuAberto ? 'Fechar' : 'Menu'}
          </button>
        </div>
        <nav aria-label="Menu principal">
          {temPermissao(...PERMISSOES_VAGAS) && (
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `menu__item menu__item--vagas${isActive ? ' menu__item--ativo' : ''}`
              }
            >
              <IconeVagas /> Vagas
            </NavLink>
          )}
          <NavLink
            to="/painel"
            className={({ isActive }) => `menu__item${isActive ? ' menu__item--ativo' : ''}`}
          >
            <IconePainel /> Painel
          </NavLink>
          {grupos.map((g) => {
            const aberto = abertos.includes(g.id) || g.id === grupoAtual;
            const Icone = g.icone;
            return (
              <div key={g.id} className={`menu__grupo${g.id === grupoAtual ? ' menu__grupo--atual' : ''}`}>
                <button
                  type="button"
                  className="menu__item menu__grupo-botao"
                  aria-expanded={aberto}
                  onClick={() => alternar(g.id)}
                >
                  <Icone /> {g.rotulo}
                  <IconeSeta tamanho={16} className={`menu__seta${aberto ? ' menu__seta--aberta' : ''}`} />
                </button>
                {aberto && (
                  <div className="menu__subitens">
                    {g.itens.map((i) => (
                      <NavLink
                        key={i.rota}
                        to={i.rota}
                        className={({ isActive }) =>
                          `menu__subitem${isActive ? ' menu__subitem--ativo' : ''}`
                        }
                      >
                        {i.rotulo}
                      </NavLink>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button type="button" className="menu__item menu__sair" onClick={() => void aoSair()}>
            <IconeSair /> Sair
          </button>
        </nav>
        <StatusSistema />
      </aside>
      <div className="layout__principal">
        <BarraSuperior
          nome={usuario?.nome ?? ''}
          perfil={usuario?.perfis.map((p) => p.nome).join(', ') ?? ''}
          onSair={() => void aoSair()}
        />
        <main className="layout__conteudo">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Data, hora e usuário (com Trocar senha e Sair). */
function BarraSuperior({ nome, perfil, onSair }: { nome: string; perfil: string; onSair: () => void }) {
  const [agora, setAgora] = useState(() => new Date());
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!menu) return;
    const fora = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menu]);
  return (
    <header className="barra-superior">
      <span className="barra-superior__info">
        <IconeCalendario tamanho={18} /> {agora.toLocaleDateString('pt-BR')}
      </span>
      <span className="barra-superior__info">
        <IconeRelogio tamanho={18} />{' '}
        {agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
      </span>
      <div className="barra-superior__usuario" ref={ref}>
        <button type="button" className="usuario-botao" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <span className="usuario-botao__avatar">
            <IconeUsuario tamanho={18} />
          </span>
          <span className="usuario-botao__texto">
            <span className="usuario-botao__nome">{nome}</span>
            <span className="usuario-botao__perfil">{perfil}</span>
          </span>
          <IconeSeta tamanho={16} />
        </button>
        {menu && (
          <div className="menu-suspenso" role="menu">
            <NavLink
              to="/trocar-senha"
              className="menu-suspenso__item"
              role="menuitem"
              onClick={() => setMenu(false)}
            >
              Trocar senha
            </NavLink>
            <button type="button" className="menu-suspenso__item" role="menuitem" onClick={onSair}>
              Sair
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

/** Rodapé do menu: o servidor local responde? */
function StatusSistema() {
  const [online, setOnline] = useState<boolean | null>(null);
  const [versao, setVersao] = useState<string | null>(null);
  useEffect(() => {
    let ativo = true;
    const verificar = () =>
      fetch('/api/v1/health/live', { cache: 'no-store' })
        .then((r) => ativo && setOnline(r.ok))
        .catch(() => ativo && setOnline(false));
    fetch('/api/v1/health', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ versao?: string }>)
      .then((d) => ativo && setVersao(d.versao ?? null))
      .catch(() => undefined);
    void verificar();
    const t = setInterval(() => void verificar(), 30_000);
    return () => {
      ativo = false;
      clearInterval(t);
    };
  }, []);
  return (
    <div className="status-sistema" role="status">
      <span
        className={`status-sistema__ponto${online === false ? ' status-sistema__ponto--fora' : ''}`}
        aria-hidden="true"
      />
      <span>
        {online === false ? 'Servidor sem resposta' : 'Sistema online'}
        {versao && <span className="status-sistema__versao">v{versao}</span>}
      </span>
    </div>
  );
}
