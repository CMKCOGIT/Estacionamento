import { NavLink, Outlet, useNavigate } from 'react-router';
import { useAuth } from '../auth/contexto';

/**
 * Itens do menu. `permissoes`: o item só aparece para quem tem UMA delas
 * (níveis de acesso). `rota: null` = módulo previsto, ainda não implementado.
 */
const MENU: { rotulo: string; rota: string | null; permissoes: string[] }[] = [
  { rotulo: 'Painel', rota: '/', permissoes: [] },
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
  {
    rotulo: 'Vagas',
    rota: '/vagas',
    permissoes: [
      'vaga.gerenciar',
      'vaga.capacidade',
      'sessao.consultar',
      'sessao.entrada',
      'relatorio.operacional',
    ],
  },
  {
    rotulo: 'Caixa',
    rota: '/caixa',
    permissoes: ['caixa.operar', 'caixa.supervisionar', 'relatorio.financeiro', 'pagamento.registrar'],
  },
  { rotulo: 'Tarifas', rota: '/tarifas', permissoes: ['tarifa.ver', 'tarifa.gerenciar', 'tarifa.publicar'] },
  { rotulo: 'Relatórios', rota: null, permissoes: ['relatorio.operacional', 'relatorio.financeiro'] },
  { rotulo: 'Funcionários', rota: '/usuarios', permissoes: ['usuario.gerenciar', 'funcionario.gerenciar'] },
  { rotulo: 'Atividades', rota: '/atividades', permissoes: ['auditoria.ver'] },
  { rotulo: 'Configurações', rota: null, permissoes: ['config.gerenciar'] },
];

export function Layout() {
  const { usuario, sair, temPermissao } = useAuth();
  const navegar = useNavigate();

  async function aoSair() {
    await sair();
    navegar('/login', { replace: true });
  }

  return (
    <div className="layout">
      <aside className="layout__menu">
        <div className="marca">
          <span className="marca__logo">P</span>
          <span>Estacionamento</span>
        </div>
        <nav>
          {MENU.filter((item) => temPermissao(...item.permissoes)).map((item) =>
            item.rota ? (
              <NavLink
                key={item.rotulo}
                to={item.rota}
                end={item.rota === '/'}
                className={({ isActive }) => `menu__item${isActive ? ' menu__item--ativo' : ''}`}
              >
                {item.rotulo}
              </NavLink>
            ) : (
              <span key={item.rotulo} className="menu__item menu__item--em-breve" title="Em breve">
                {item.rotulo}
              </span>
            ),
          )}
        </nav>

        {usuario && (
          <div className="usuario">
            <div className="usuario__nome">{usuario.nome}</div>
            <div className="usuario__perfil">{usuario.perfis.map((p) => p.nome).join(', ')}</div>
            <div className="usuario__acoes">
              <NavLink to="/trocar-senha" className="botao-texto">
                Trocar senha
              </NavLink>
              <button type="button" className="botao-texto" onClick={() => void aoSair()}>
                Sair
              </button>
            </div>
          </div>
        )}
      </aside>
      <main className="layout__conteudo">
        <Outlet />
      </main>
    </div>
  );
}
