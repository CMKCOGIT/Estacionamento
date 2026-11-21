import { useCallback, useEffect, useState } from 'react';
import { syncApi, type StatusSync } from '../services/configuracoes';

const SITUACAO: Record<StatusSync['situacao'], { texto: string; classe: string }> = {
  DESLIGADA: { texto: 'Desligada', classe: 'alerta--info' },
  EM_DIA: { texto: 'Em dia', classe: 'alerta--ok' },
  ENVIANDO: { texto: 'Enviando', classe: 'alerta--info' },
  AGUARDANDO_PRIMEIRO_ENVIO: { texto: 'Aguardando o primeiro envio', classe: 'alerta--info' },
  COM_FALHA: { texto: 'Com falha', classe: 'alerta--erro' },
};
const TIPO_EXECUCAO: Record<string, string> = {
  PUSH: 'Envio',
  SNAPSHOT: 'Carga completa',
  CONFERENCIA: 'Conferência',
};
const ORIGEM: Record<string, string> = {
  APLICACAO: 'pelo sistema',
  DETECCAO: 'detectadas no banco',
  CONFERENCIA: 'correções',
};
const RESULTADO: Record<string, string> = {
  APLICADO: 'aplicadas',
  REPETIDO: 'repetidas (ignoradas)',
  SUPERADO: 'superadas',
  REJEITADO: 'recusadas',
  PENDENTE: 'na fila',
  ENVIADO: 'enviadas',
};
function resumirDetalhes(d: Record<string, unknown> | null): string {
  if (!d) return '';
  const partes: string[] = [];
  if (typeof d.aplicados === 'number') partes.push(`${d.aplicados} aplicados`);
  if (d.repetidos) partes.push(`${String(d.repetidos)} repetidos`);
  if (d.superados) partes.push(`${String(d.superados)} superados`);
  if (d.rejeitados) partes.push(`${String(d.rejeitados)} recusados`);
  if (typeof d.tickets === 'number') partes.push(`${d.tickets} tickets`);
  if (typeof d.conferidos === 'number') {
    const dif =
      (Array.isArray(d.divergentes) ? d.divergentes.length : 0) +
      (Array.isArray(d.sobrando) ? d.sobrando.length : 0);
    partes.push(`${d.conferidos} conferidos, ${dif ? `${dif} corrigidos` : 'tudo igual'}`);
  }
  return partes.join(', ');
}
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

  async function pedir(acao: 'ressincronizar' | 'conferir') {
    setEnviando(true);
    try {
      setS(await syncApi[acao]());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível fazer o pedido.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-labelledby="titulo-sync" className="secao-sync">
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
                : s.pendentes + s.marcasPendentes > 0
                  ? `${s.pendentes + s.marcasPendentes} alteração(ões) na fila.`
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
            <div>
              <dt>Última conferência dos bancos</dt>
              <dd>
                {s.conferenciaPendente
                  ? 'agendada'
                  : s.ultimaConferenciaEm
                    ? `${quando(s.ultimaConferenciaEm)} · ${
                        s.ultimaConferenciaDivergencias
                          ? `${s.ultimaConferenciaDivergencias} diferença(s) corrigida(s)`
                          : 'tudo igual'
                      }`
                    : '—'}
              </dd>
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
                onClick={() => void pedir('conferir')}
                disabled={enviando || s.conferenciaPendente}
                title="Compara os dados da nuvem com os deste servidor e corrige as diferenças"
              >
                Conferir agora
              </button>
              <button
                type="button"
                className="botao botao--secundario"
                onClick={() => void pedir('ressincronizar')}
                disabled={enviando || s.snapshotPendente}
                title="Reenvia todo o estado atual para a nuvem"
              >
                Ressincronizar
              </button>
            </div>
          )}
          {s.historico.length > 0 && (
            <details className="historico-sync">
              <summary>Histórico das sincronizações ({s.historico.length} mais recentes)</summary>
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Tipo</th>
                      <th>Resultado</th>
                      <th className="numero">Itens</th>
                      <th className="numero">Duração</th>
                      <th>Detalhe</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.historico.map((h) => (
                      <tr key={h.id}>
                        <td>{quando(h.iniciadoEm)}</td>
                        <td>{TIPO_EXECUCAO[h.tipo] ?? h.tipo}</td>
                        <td>
                          <span
                            className={`etiqueta ${h.sucesso ? 'etiqueta--ativo' : 'etiqueta--bloqueado'}`}
                          >
                            {h.sucesso ? 'OK' : 'Falhou'}
                          </span>
                        </td>
                        <td className="numero">{h.itens}</td>
                        <td className="numero">{h.duracaoMs === null ? '—' : `${h.duracaoMs} ms`}</td>
                        <td className="detalhe-sync">
                          {h.erro ?? resumirDetalhes(h.detalhes)}
                          {h.requisicaoId && (
                            <small title="Id da requisição na nuvem">#{h.requisicaoId.slice(0, 8)}</small>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.resumo.length > 0 && (
                <p className="mudo">
                  Últimos 30 dias:{' '}
                  {s.resumo
                    .map(
                      (x) =>
                        `${ORIGEM[x.origem] ?? x.origem}: ${x.total} ${RESULTADO[x.resultado] ?? x.resultado}`,
                    )
                    .join(' · ')}
                </p>
              )}
            </details>
          )}
        </>
      )}
    </section>
  );
}
