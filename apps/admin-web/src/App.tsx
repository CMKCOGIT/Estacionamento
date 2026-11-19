import { Layout } from './components/Layout';
import { Inicio } from './pages/Inicio';

/**
 * Raiz do painel. Quando houver mais telas, entra aqui o roteador
 * (react-router) e a proteção de rotas por login/permissão.
 */
export function App() {
  return (
    <Layout>
      <Inicio />
    </Layout>
  );
}
