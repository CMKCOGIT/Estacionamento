import { useCallback, useEffect, useState } from 'react';
import { syncApi, type StatusSync } from '../services/configuracoes';

const SITUACAO: Record<StatusSync['situacao'], { texto: string; classe: string }> = {
  DESLIGADA: { texto: 'Desligada', classe: 'alerta--info' },
  EM_DIA: { texto: 'Em dia', classe: 'alerta--ok' },
  ENVIANDO: { texto: 'Enviando', classe: 'alerta--info' },
  AGUARDANDO_PRIMEIRO_ENVIO: { texto: 'Aguardando o primeiro envio', classe: 'alerta--info' },
  COM_FALHA: { texto: 'Com falha', classe: 'alerta--erro' },
};
const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';

/**
 * Situação do envio dos dados para a API externa (app do cliente).
 * A operação do estacionamento nunca depende disto: sem internet, os dados
 * ficam na fila e vão quando a conexão voltar.
 */
export function StatusSincronizacao() {
  const [s, setS] = useState<StatusSync | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(
    () =>
      syncApi.status().then(
        (x) => {
          setS(x);
          setErro(null);
        },
        (e: unknown) => setErro(e instanceof Error ? e.message : 'Não foi possível consultar.'),
      ),
    [],
  );
  useEffect(() => {
    void carregar();
    const t = setInterval(() => void carregar(), 10_000);
    return () => clearInterval(t);
  }, [carregar]);

  async function ressincronizar() {
    setEnviando(true);
    try {
      setS(await syncApi.ressincronizar());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível pedir a ressincronização.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-labelledby="titulo-sync">
      <h2 id="titulo-sync">Sincronização com a nuvem (app do cliente)</h2>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {s && (
        <>
          <p className={`alerta ${SITUACAO[s.situacao].classe}`} role="status">
            <b>{SITUACAO[s.situacao].texto}.</b>{' '}
            {s.situacao === 'DESLIGADA'
              ? 'Configure CLOUD_API_URL, SYNC_INTEGRACAO_ID e SYNC_SECRET no .env do servidor local para o app do cliente receber os dados.'
              : s.situacao === 'COM_FALHA'
                ? `${s.ultimoErro ?? ''} Os dados continuam guardados e serão enviados automaticamente.`
                : s.pendentes > 0
                  ? `${s.pendentes} alteração(ões) na fila.`
                  : 'Tudo enviado.'}
          </p>
          <dl className="detalhes-sync">
            <div>
              <dt>Nuvem</dt>
              <dd>{s.nuvem ?? '—'}</dd>
            </div>
            <div>
              <dt>Último envio confirmado</dt>
              <dd>{quando(s.ultimoSucessoEm)}</dd>
            </div>
            <div>
              <dt>Na fila</dt>
              <dd>
                {s.pendentes}
                {s.pendenteMaisAntigoEm ? ` (desde ${quando(s.pendenteMaisAntigoEm)})` : ''}
              </dd>
            </div>
            <div>
              <dt>Última carga completa</dt>
              <dd>{s.snapshotPendente ? 'agendada' : quando(s.ultimoSnapshotEm)}</dd>
            </div>
          </dl>
          {s.rejeitados.length > 0 && (
            <div className="alerta alerta--erro">
              <p>
                <b>{s.rejeitados.length} alteração(ões) recusada(s) pela nuvem.</b> Elas não aparecem no app
                do cliente. Use "Ressincronizar" para reenviar o estado atual.
              </p>
              <ul>
                {s.rejeitados.slice(0, 5).map((r) => (
                  <li key={r.seq}>
                    {r.tipo} · {quando(r.em)} · {r.erro}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {s.configurado && (
            <div className="acoes">
              <button
                type="button"
                className="botao botao--secundario"
                onClick={() => void ressincronizar()}
                disabled={enviando || s.snapshotPendente}
              >
                {enviando ? 'Pedindo…' : 'Ressincronizar'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
