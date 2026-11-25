import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { POLITICA_SENHA, problemasDaSenha } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { ErroDaApi } from '../services/api';

export function TrocarSenha() {
  const { usuario, trocarSenha, sair, regrasSenha } = useAuth();
  const minimo = Math.max(POLITICA_SENHA.minimo, regrasSenha?.minimo ?? 0);
  const navegar = useNavigate();
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const obrigatoria = usuario?.deveTrocarSenha ?? false;
  const problemas = nova ? problemasDaSenha(nova, usuario?.login, regrasSenha ?? undefined) : [];
  const confere = confirmacao.length > 0 && confirmacao === nova;

  async function aoEnviar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    if (problemas.length || !confere) {
      setErro(
        !confere ? 'A confirmação não confere com a nova senha.' : 'A nova senha não atende às regras.',
      );
      return;
    }
    setEnviando(true);
    try {
      await trocarSenha({ senhaAtual: atual, novaSenha: nova });
      setSucesso(true);
      setAtual('');
      setNova('');
      setConfirmacao('');
      if (obrigatoria) navegar('/', { replace: true });
    } catch (falha) {
      if (falha instanceof ErroDaApi && Array.isArray(falha.corpo.detalhes)) {
        setErro(falha.corpo.detalhes.map((d) => d.mensagem).join('. '));
      } else {
        setErro(falha instanceof Error ? falha.message : 'Não foi possível trocar a senha.');
      }
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section className="cartao cartao--estreito">
      <h1>Trocar senha</h1>
      {obrigatoria && (
        <p className="alerta alerta--info">Por segurança, defina uma nova senha antes de continuar.</p>
      )}
      {sucesso && (
        <p className="alerta alerta--ok" role="status">
          Senha alterada. As outras sessões abertas com seu usuário foram encerradas.
        </p>
      )}
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      <form onSubmit={aoEnviar} noValidate>
        <label className="campo">
          <span>Senha atual</span>
          <input
            type="password"
            autoComplete="current-password"
            value={atual}
            onChange={(e) => setAtual(e.target.value)}
          />
        </label>
        <label className="campo">
          <span>Nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={nova}
            onChange={(e) => setNova(e.target.value)}
          />
        </label>
        <ul className="regras">
          <li className={nova.length >= minimo ? 'ok' : ''}>Pelo menos {minimo} caracteres</li>
          <li className={/[A-Za-zÀ-ÿ]/.test(nova) && /[0-9]/.test(nova) ? 'ok' : ''}>Letras e números</li>
          {regrasSenha?.exigirMaiuscula && (
            <li className={/[A-ZÀ-Þ]/.test(nova) ? 'ok' : ''}>Uma letra maiúscula</li>
          )}
          {regrasSenha?.exigirSimbolo && (
            <li className={/[^A-Za-zÀ-ÿ0-9]/.test(nova) ? 'ok' : ''}>Um símbolo (ex.: ! @ # $)</li>
          )}
          <li className={nova && !problemas.some((p) => p.includes('login')) ? 'ok' : ''}>
            Não conter o login
          </li>
        </ul>
        <label className="campo">
          <span>Confirmar nova senha</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => setConfirmacao(e.target.value)}
          />
        </label>
        <div className="acoes">
          <button type="submit" className="botao" disabled={enviando}>
            {enviando ? 'Salvando…' : 'Salvar nova senha'}
          </button>
          {obrigatoria ? (
            <button type="button" className="botao botao--secundario" onClick={() => void sair()}>
              Sair
            </button>
          ) : (
            <button type="button" className="botao botao--secundario" onClick={() => navegar(-1)}>
              Voltar
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
