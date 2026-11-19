import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/contexto';
import { ErroDaApi } from '../services/api';

export function Login() {
  const { usuario, verificando, entrar, aviso } = useAuth();
  const navegar = useNavigate();
  const local = useLocation();
  const destino = (local.state as { de?: string } | null)?.de ?? '/';

  const [login, setLogin] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (verificando) return <div className="tela-carregando">Carregando…</div>;
  if (usuario) return <Navigate to={destino} replace />;

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    if (!login.trim() || !senha) {
      setErro('Informe o usuário e a senha.');
      return;
    }
    setEnviando(true);
    setErro(null);
    try {
      await entrar(login, senha);
      navegar(destino, { replace: true });
    } catch (falha) {
      setErro(falha instanceof ErroDaApi ? falha.message : 'Não foi possível entrar. Tente novamente.');
      setSenha('');
    } finally {
      setEnviando(false);
    }
  }

  const verificarCaps = (e: KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock'));

  return (
    <main className="login">
      <form className="login__cartao" onSubmit={aoEnviar} noValidate>
        <div className="marca marca--login">
          <span className="marca__logo">P</span>
          <span>Estacionamento</span>
        </div>
        <h1>Entrar no painel</h1>

        {aviso && !erro && (
          <p className="alerta alerta--info" role="status">
            {aviso}
          </p>
        )}
        {erro && (
          <p className="alerta alerta--erro" role="alert">
            {erro}
          </p>
        )}

        <label className="campo">
          <span>Usuário</span>
          <input
            name="login"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={login}
            onChange={(e) => setLogin(e.target.value)}
            disabled={enviando}
          />
        </label>

        <label className="campo">
          <span>Senha</span>
          <div className="campo__senha">
            <input
              name="senha"
              type={mostrarSenha ? 'text' : 'password'}
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              onKeyUp={verificarCaps}
              onKeyDown={verificarCaps}
              disabled={enviando}
            />
            <button
              type="button"
              className="botao-texto"
              onClick={() => setMostrarSenha((v) => !v)}
              aria-label={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {mostrarSenha ? 'Ocultar' : 'Mostrar'}
            </button>
          </div>
          {capsLock && <small className="aviso-caps">Caps Lock está ativado</small>}
        </label>

        <button type="submit" className="botao botao--bloco" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
        <p className="mudo login__rodape">Esqueceu a senha? Peça a um administrador para redefinir.</p>
      </form>
    </main>
  );
}
