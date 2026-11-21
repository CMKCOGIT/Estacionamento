import { useCallback, useEffect, useState } from 'react';
import { backupsApi, type RegistroBackup, type SituacaoBackups } from '../services/backups';

const quando = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const tamanho = (b: number | null) =>
  b === null ? '—' : b < 1_048_576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1_048_576).toFixed(1)} MB`;
const horasDesde = (iso: string | null) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity);

/** Backups do banco local: situação, histórico, conferência e teste de restauração. */
export function Backups() {
  const [dados, setDados] = useState<{ situacao: SituacaoBackups; itens: RegistroBackup[] } | null>(null);
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(
    () =>
      backupsApi
        .listar()
        .then(setDados, (e: unknown) =>
          setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Não foi possível carregar.' }),
        ),
    [],
  );
  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function acao(nome: string, fn: () => Promise<string>) {
    setOcupado(nome);
    setMsg({ tipo: 'info', texto: 'Trabalhando… o estacionamento continua funcionando normalmente.' });
    try {
      setMsg({ tipo: 'ok', texto: await fn() });
    } catch (e) {
      setMsg({ tipo: 'erro', texto: e instanceof Error ? e.message : 'Falhou.' });
    } finally {
      setOcupado(null);
      void carregar();
    }
  }

  const s = dados?.situacao;
  const atrasado = s && horasDesde(s.ultimoSucesso?.iniciadoEm ?? null) > 26;
  const falhaRecente =
    s?.ultimaFalha && (!s.ultimoSucesso || s.ultimaFalha.iniciadoEm > s.ultimoSucesso.iniciadoEm);
  return (
    <section className="cartao">
      <h1>Backups do banco de dados</h1>
      {msg && (
        <p className={`alerta alerta--${msg.tipo}`} role="status">
          {msg.texto}
        </p>
      )}
      {s && (
        <>
          <p
            className={`alerta ${!s.ativo || falhaRecente || s.comProblema || atrasado ? 'alerta--erro' : 'alerta--ok'}`}
            role="status"
          >
            {!s.ativo
              ? 'Backup automático DESLIGADO (BACKUP_ATIVO=false no .env).'
              : falhaRecente
                ? `O último backup falhou (${quando(s.ultimaFalha!.iniciadoEm)}): ${s.ultimaFalha!.erro}`
                : s.comProblema
                  ? `${s.comProblema} backup(s) com problema na conferência. Veja a lista abaixo.`
                  : atrasado
                    ? 'Nenhum backup nas últimas 26 horas.'
                    : `Em dia. Último backup: ${quando(s.ultimoSucesso?.iniciadoEm ?? null)}, conferido.`}
          </p>
          <dl className="detalhes-sync">
            <div>
              <dt>Próximo automático</dt>
              <dd>
                {quando(s.proximoEm)} (todo dia às {s.horario})
              </dd>
            </div>
            <div>
              <dt>Guardados</dt>
              <dd>
                {s.guardados} · {tamanho(s.bytesGuardados)}
              </dd>
            </div>
            <div>
              <dt>Retenção</dt>
              <dd>
                {s.retencao.diarios} diários, {s.retencao.semanais} semanais, {s.retencao.mensais} mensais
              </dd>
            </div>
            <div>
              <dt>Segunda cópia</dt>
              <dd>{s.copia ?? 'não configurada (BACKUP_COPIA_DIR)'}</dd>
            </div>
          </dl>
          <p className="mudo pequeno">
            Pasta: {s.pasta}. Criptografados com a chave <code>{s.chaveId}</code>
            {s.chaveNoArquivo && ' (arquivo apps/local-server/segredos/backup.chave)'}.{' '}
            <b>Guarde uma cópia da chave fora deste computador</b>: sem ela, nenhum backup pode ser
            restaurado.
          </p>
          {!s.copia && (
            <p className="alerta alerta--info">
              Os backups estão só neste computador. Se o disco falhar, eles se perdem juntos. Configure
              BACKUP_COPIA_DIR (pen drive, outro computador ou pasta do OneDrive/Google Drive).
            </p>
          )}
          <div className="acoes">
            <button
              type="button"
              className="botao"
              disabled={!!ocupado || s.emAndamento}
              onClick={() =>
                void acao('criar', async () => {
                  const r = await backupsApi.criar();
                  if (r.status !== 'SUCESSO') throw new Error(`Backup falhou: ${r.erro}`);
                  return `Backup feito e conferido: ${r.arquivo} (${tamanho(r.tamanhoBytes)}).`;
                })
              }
            >
              {ocupado === 'criar' || s.emAndamento ? 'Fazendo backup…' : 'Fazer backup agora'}
            </button>
          </div>
        </>
      )}

      <h2>Histórico</h2>
      {dados && dados.itens.length === 0 && <p className="mudo">Nenhum backup ainda.</p>}
      {dados && dados.itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Tipo</th>
                <th>Resultado</th>
                <th className="numero">Tamanho</th>
                <th>Conferência</th>
                <th>Restauração testada</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((b) => (
                <tr key={b.id} className={b.removidoEm ? 'linha-apagada' : undefined}>
                  <td>{quando(b.iniciadoEm)}</td>
                  <td>{b.tipo === 'MANUAL' ? 'Manual' : 'Automático'}</td>
                  <td>
                    <span
                      className={`etiqueta ${b.status === 'SUCESSO' ? 'etiqueta--ativo' : b.status === 'FALHA' ? 'etiqueta--bloqueado' : 'etiqueta--inativo'}`}
                    >
                      {b.status === 'SUCESSO' ? 'OK' : b.status === 'FALHA' ? 'Falhou' : 'Em andamento'}
                    </span>
                    {b.erro && <small className="bloco mudo">{b.erro}</small>}
                    {b.removidoEm && (
                      <small className="bloco mudo">Apagado pela retenção em {quando(b.removidoEm)}</small>
                    )}
                  </td>
                  <td className="numero">{tamanho(b.tamanhoBytes)}</td>
                  <td>
                    {b.verificacao ? (
                      <span className={b.verificacao === 'OK' ? undefined : 'texto-falha'}>
                        {b.verificacao === 'OK'
                          ? 'Íntegro'
                          : b.verificacao === 'AUSENTE'
                            ? 'Arquivo sumiu'
                            : 'Corrompido'}{' '}
                        <small className="mudo">{quando(b.verificadoEm)}</small>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{quando(b.restauracaoTestadaEm)}</td>
                  <td>
                    {b.status === 'SUCESSO' && !b.removidoEm && (
                      <span className="atender-lgpd">
                        <button
                          type="button"
                          className="botao-texto"
                          disabled={!!ocupado}
                          onClick={() =>
                            void acao(`v${b.id}`, async () => {
                              const r = await backupsApi.verificar(b.id);
                              return r.verificacao === 'OK'
                                ? 'Arquivo íntegro: hash, chave e conteúdo conferidos.'
                                : `Problema: ${r.erro}`;
                            })
                          }
                        >
                          Conferir
                        </button>
                        <button
                          type="button"
                          className="botao-texto"
                          disabled={!!ocupado}
                          onClick={() =>
                            void acao(`t${b.id}`, async () => {
                              const r = await backupsApi.testar(b.id);
                              if (!r.ok) throw new Error(`Teste de restauração falhou: ${r.detalhe}`);
                              return `Teste de restauração OK: ${r.detalhe} (num banco temporário, já apagado).`;
                            })
                          }
                        >
                          Testar restauração
                        </button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mudo pequeno">
        Para restaurar um backup (servidor danificado ou perda de dados), siga o docs/BACKUP.md: pare o
        servidor e use o Restaurar-Backup.cmd.
      </p>
    </section>
  );
}
