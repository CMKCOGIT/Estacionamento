import { useCallback } from 'react';
import { useAuth } from '../auth/contexto';
import type { FormaPagamento, Lista, StatusSistema } from '@estacionamento/shared';
import { useCarregar } from '../hooks/useCarregar';
import { api, apiComStatus } from '../services/api';

/** Tela inicial provisória: mostra se API e banco estão funcionando. */
export function Inicio() {
  const { usuario } = useAuth();
  const saude = useCarregar(useCallback(() => apiComStatus<StatusSistema>('/health'), []));
  const formas = useCarregar(useCallback(() => api<Lista<FormaPagamento>>('/formas-pagamento'), []));

  const status = saude.dados?.corpo;
  const apiOk = saude.dados !== null && saude.dados.status !== 0;
  const bancoOk = status?.banco.ok ?? false;

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Painel do estacionamento</h1>
          <p className="mudo">Olá, {usuario?.nome}.</p>
        </div>
        <button type="button" className="botao" onClick={() => (saude.recarregar(), formas.recarregar())}>
          Atualizar
        </button>
      </header>

      <section className="cartoes">
        <article className="cartao">
          <h2>Servidor local</h2>
          {saude.carregando ? (
            <p className="mudo">Verificando…</p>
          ) : (
            <>
              <Indicador ok={apiOk} texto={apiOk ? 'Funcionando' : 'Inacessível'} />
              {status && (
                <p className="mudo">
                  v{status.versao} · {status.ambiente} · no ar há {formatarDuracao(status.uptimeSegundos)}
                </p>
              )}
            </>
          )}
        </article>

        <article className="cartao">
          <h2>Banco de dados</h2>
          {saude.carregando ? (
            <p className="mudo">Verificando…</p>
          ) : (
            <>
              <Indicador ok={bancoOk} texto={bancoOk ? 'Conectado' : 'Indisponível'} />
              <p className="mudo">
                {bancoOk
                  ? `MySQL ${status?.banco.versao} · ${status?.banco.nome} · ${status?.banco.latenciaMs} ms`
                  : (status?.banco.erro ?? 'Sem resposta do servidor')}
              </p>
            </>
          )}
        </article>
      </section>

      <section className="cartao">
        <h2>Formas de pagamento cadastradas</h2>
        {formas.carregando && <p className="mudo">Carregando…</p>}
        {formas.erro && <p className="erro">{formas.erro.message}</p>}
        {formas.dados && (
          <table className="tabela">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Troco</th>
                <th>Autorização</th>
                <th>Parcelas</th>
              </tr>
            </thead>
            <tbody>
              {formas.dados.itens.map((f) => (
                <tr key={f.codigo}>
                  <td>
                    <code>{f.codigo}</code>
                  </td>
                  <td>{f.nome}</td>
                  <td>{f.permiteTroco ? 'Sim' : '—'}</td>
                  <td>{f.exigeAutorizacao ? 'NSU / código' : '—'}</td>
                  <td>{f.permiteParcelas ? 'Sim' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Indicador({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <p className={`indicador ${ok ? 'indicador--ok' : 'indicador--falha'}`}>
      <span className="indicador__ponto" aria-hidden="true" />
      {texto}
    </p>
  );
}

function formatarDuracao(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  if (segundos < 3600) return `${Math.floor(segundos / 60)} min`;
  return `${Math.floor(segundos / 3600)} h ${Math.floor((segundos % 3600) / 60)} min`;
}
