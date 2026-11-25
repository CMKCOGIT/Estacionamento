import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AuthProvider } from './auth/AuthProvider';
import { RotaProtegida } from './auth/RotaProtegida';
import { Layout, PERMISSOES_VAGAS } from './components/Layout';
import { useAuth } from './auth/contexto';
import { Atividades } from './pages/Atividades';
import { Backups } from './pages/Backups';
import { Monitoramento } from './pages/Monitoramento';
import { Movimentacoes } from './pages/Movimentacoes';
import { Caixa } from './pages/Caixa';
import { Configuracoes } from './pages/Configuracoes';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Operacao } from './pages/Operacao';
import { Privacidade } from './pages/Privacidade';
import { Relatorios } from './pages/Relatorios';
import { RelatoriosAdministrativos } from './pages/RelatoriosAdministrativos';
import { Tarifas } from './pages/Tarifas';
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
            {/* Vagas é a tela principal; quem não vê vagas cai no Painel */}
            <Route index element={<Inicio />} />
            <Route path="painel" element={<Dashboard />} />
            <Route path="trocar-senha" element={<TrocarSenha />} />
            <Route
              path="relatorios"
              element={
                <RotaProtegida permissoes={['relatorio.financeiro', 'caixa.supervisionar']}>
                  <Relatorios />
                </RotaProtegida>
              }
            />
            <Route
              path="caixa"
              element={
                <RotaProtegida
                  permissoes={[
                    'caixa.operar',
                    'caixa.supervisionar',
                    'relatorio.financeiro',
                    'pagamento.registrar',
                  ]}
                >
                  <Caixa />
                </RotaProtegida>
              }
            />
            <Route
              path="tarifas"
              element={
                <RotaProtegida permissoes={['tarifa.ver', 'tarifa.gerenciar', 'tarifa.publicar']}>
                  <Tarifas />
                </RotaProtegida>
              }
            />
            <Route
              path="operacao"
              element={
                <RotaProtegida permissoes={['sessao.entrada', 'sessao.saida']}>
                  <Operacao />
                </RotaProtegida>
              }
            />
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
            <Route path="vagas" element={<Navigate to="/" replace />} />
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
            <Route
              path="relatorios-administrativos"
              element={
                <RotaProtegida permissoes={['relatorio.operacional']}>
                  <RelatoriosAdministrativos />
                </RotaProtegida>
              }
            />
            <Route
              path="backups"
              element={
                <RotaProtegida permissoes={['backup.gerenciar']}>
                  <Backups />
                </RotaProtegida>
              }
            />
            <Route
              path="monitoramento"
              element={
                <RotaProtegida permissoes={['sistema.monitorar']}>
                  <Monitoramento />
                </RotaProtegida>
              }
            />
            <Route
              path="privacidade"
              element={
                <RotaProtegida permissoes={['lgpd.atender']}>
                  <Privacidade />
                </RotaProtegida>
              }
            />
            <Route
              path="configuracoes"
              element={
                <RotaProtegida permissoes={['config.gerenciar', 'config.seguranca']}>
                  <Configuracoes />
                </RotaProtegida>
              }
            />
            <Route
              path="movimentacoes"
              element={
                <RotaProtegida permissoes={['sessao.consultar', 'sessao.entrada', 'sessao.saida']}>
                  <Movimentacoes />
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

function Inicio() {
  const { temPermissao } = useAuth();
  return temPermissao(...PERMISSOES_VAGAS) ? <Vagas /> : <Navigate to="/painel" replace />;
}
