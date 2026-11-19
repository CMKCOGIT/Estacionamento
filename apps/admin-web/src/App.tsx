import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RotaProtegida } from './auth/RotaProtegida';
import { Layout } from './components/Layout';
import { Inicio } from './pages/Inicio';
import { Login } from './pages/Login';
import { TrocarSenha } from './pages/TrocarSenha';

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
            <Route index element={<Inicio />} />
            <Route path="trocar-senha" element={<TrocarSenha />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
