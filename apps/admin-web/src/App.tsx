import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RotaProtegida } from './auth/RotaProtegida';
import { Layout } from './components/Layout';
import { Atividades } from './pages/Atividades';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { TrocarSenha } from './pages/TrocarSenha';
import { UsuarioForm } from './pages/UsuarioForm';
import { Vagas } from './pages/Vagas';
import { VeiculoDetalhe } from './pages/VeiculoDetalhe';
import { Veiculos } from './pages/Veiculos';
import { Usuarios } from './pages/Usuarios';

/**
 * Rotas do painel. Tudo dentro de <RotaProtegida> exige login; telas de um
 * módulo específico recebem `permissoes` (ex.: ['tarifa.ver']).
 */
export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <RotaProtegida>
                <Layout />
              </RotaProtegida>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="trocar-senha" element={<TrocarSenha />} />
            <Route
              path="veiculos"
              element={
                <RotaProtegida
                  permissoes={[
                    'veiculo.gerenciar',
                    'sessao.consultar',
                    'sessao.entrada',
                    'sessao.saida',
                    'relatorio.operacional',
                  ]}
                >
                  <Veiculos />
                </RotaProtegida>
              }
            />
            <Route
              path="veiculos/:id"
              element={
                <RotaProtegida
                  permissoes={[
                    'veiculo.gerenciar',
                    'sessao.consultar',
                    'sessao.entrada',
                    'sessao.saida',
                    'relatorio.operacional',
                  ]}
                >
                  <VeiculoDetalhe />
                </RotaProtegida>
              }
            />
            <Route
              path="vagas"
              element={
                <RotaProtegida
                  permissoes={[
                    'vaga.gerenciar',
                    'vaga.capacidade',
                    'sessao.consultar',
                    'sessao.entrada',
                    'relatorio.operacional',
                  ]}
                >
                  <Vagas />
                </RotaProtegida>
              }
            />
            <Route
              path="usuarios"
              element={
                <RotaProtegida permissoes={['usuario.gerenciar', 'funcionario.gerenciar']}>
                  <Usuarios />
                </RotaProtegida>
              }
            />
            <Route
              path="usuarios/novo"
              element={
                <RotaProtegida permissoes={['funcionario.gerenciar', 'usuario.gerenciar']}>
                  <UsuarioForm />
                </RotaProtegida>
              }
            />
            <Route
              path="usuarios/:id"
              element={
                <RotaProtegida permissoes={['usuario.gerenciar', 'funcionario.gerenciar']}>
                  <UsuarioForm />
                </RotaProtegida>
              }
            />
            <Route
              path="atividades"
              element={
                <RotaProtegida permissoes={['auditoria.ver']}>
                  <Atividades />
                </RotaProtegida>
              }
            />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
