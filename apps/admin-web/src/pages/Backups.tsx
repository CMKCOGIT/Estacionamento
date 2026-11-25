import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import { ErroDaApi } from '../services/api';
import { backupsApi, type RegistroBackup, type SituacaoBackups } from '../services/backups';
import { configGeralApi } from '../services/configuracoes';

const TIPOS: Record<string, string> = {
  MANUAL: 'Manual',
  AUTOMATICO: 'Automático',
  PRE_RESTAURACAO: 'Antes de restaurar',
};

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
  const [restaurar, setRestaurar] = useState<RegistroBackup | null>(null);
  const { temPermissao } = useAuth();

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
              ? 'Backup automático DESLIGADO. Ligue em "Agenda do backup automático", abaixo.'
              : falhaRecente
                ? `O último backup falhou (${quando(s.ultimaFalha!.iniciadoEm)}): ${s.ultimaFalha!.erro}`
                : s.comProblema
                  ? `${s.comProblema} backup(s) com problema na conferência. Veja a lista abaixo.`
                  : atrasado
                    ? 'Nenhum backup nas últimas 26 horas.'
                    : `Em dia. Último backup: ${quando(s.ultimoSucesso?.iniciadoEm ?? null)}, conferido.`}
          </p>
          {s.ultimaRestauracao && (
            <p className="alerta alerta--info">
              Última restauração: {quando(s.ultimaRestauracao.em)}
              {s.ultimaRestauracao.por && ` por ${s.ultimaRestauracao.por}`}, do arquivo{' '}
              <code>{s.ultimaRestauracao.arquivo}</code>
              {s.ultimaRestauracao.backupSeguranca && (
                <>
                  . O estado anterior foi guardado em <code>{s.ultimaRestauracao.backupSeguranca}</code>
                </>
              )}
              .
            </p>
          )}
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
                  <td>{TIPOS[b.tipo] ?? b.tipo}</td>
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
                        <a className="botao-texto" href={backupsApi.urlArquivo(b.id)} download>
                          Baixar
                        </a>
                        <button
                          type="button"
                          className="botao-texto texto-falha"
                          disabled={!!ocupado}
                          onClick={() => setRestaurar(b)}
                        >
                          Restaurar
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
        O arquivo baixado continua criptografado: só abre com a chave do backup. Se o servidor não abrir
        (computador danificado), restaure pelo Restaurar-Backup.cmd, conforme o docs/BACKUP.md.
      </p>
      {s && temPermissao('config.seguranca') && <Agenda situacao={s} onSalvo={() => void carregar()} />}
      <DialogoRestaurar
        backup={restaurar}
        onFechar={() => setRestaurar(null)}
        onRestaurado={(texto) => {
          setRestaurar(null);
          setMsg({ tipo: 'ok', texto });
          void carregar();
        }}
      />
    </section>
  );
}

/** Liga/desliga e muda o horário do backup automático (só Administrador). */
function Agenda({ situacao, onSalvo }: { situacao: SituacaoBackups; onSalvo: () => void }) {
  const [ativo, setAtivo] = useState(situacao.ativo);
  const [horario, setHorario] = useState(situacao.horario);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const alterado = ativo !== situacao.ativo || horario !== situacao.horario;
  return (
    <section className="cartao cartao--interno">
      <h2>Agenda do backup automático</h2>
      <div className="grade-config">
        <label className="opcao-check">
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} />
          <span>
            <strong>Fazer backup todo dia</strong>
            <small>Recomendado. Desligar só em computador de testes.</small>
          </span>
        </label>
        <label className="campo">
          <span>Horário</span>
          <input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} required />
          <small>Escolha um horário com o computador ligado e pouco movimento.</small>
        </label>
      </div>
      {erro && (
        <p className="alerta alerta--erro" role="alert">
          {erro}
        </p>
      )}
      {ok && (
        <p className="alerta alerta--ok" role="status">
          Agenda salva.
        </p>
      )}
      <div className="acoes">
        <button
          type="button"
          className="botao"
          disabled={!alterado || enviando || !/^\d{2}:\d{2}$/.test(horario)}
          onClick={() => {
            setEnviando(true);
            setErro(null);
            setOk(false);
            configGeralApi
              .salvar('backup', { ativo, horario })
              .then(() => {
                setOk(true);
                onSalvo();
              })
              .catch((e: unknown) => setErro(e instanceof Error ? e.message : 'Não foi possível salvar.'))
              .finally(() => setEnviando(false));
          }}
        >
          {enviando ? 'Salvando…' : 'Salvar agenda'}
        </button>
      </div>
    </section>
  );
}

/**
 * Restaurar substitui TODO o banco atual pelo conteúdo do backup. Pede a
 * senha de quem está restaurando e que digite RESTAURAR.
 */
function DialogoRestaurar({
  backup,
  onFechar,
  onRestaurado,
}: {
  backup: RegistroBackup | null;
  onFechar: () => void;
  onRestaurado: (texto: string) => void;
}) {
  const [senha, setSenha] = useState('');
  const [confirmacao, setConfirmacao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [anterior, setAnterior] = useState(backup);
  if (anterior !== backup) {
    setAnterior(backup);
    setSenha('');
    setConfirmacao('');
    setErro(null);
  }
  return (
    <Dialogo
      aberto={!!backup}
      titulo="Restaurar backup"
      textoConfirmar={enviando ? 'Restaurando…' : 'Restaurar agora'}
      perigo
      enviando={enviando}
      erro={erro}
      onFechar={() => !enviando && onFechar()}
      onConfirmar={() => {
        if (!backup) return;
        if (confirmacao !== 'RESTAURAR') {
          setErro('Digite RESTAURAR (em maiúsculas) para confirmar.');
          return;
        }
        if (!senha) {
          setErro('Confirme a sua senha.');
          return;
        }
        setEnviando(true);
        setErro(null);
        backupsApi
          .restaurar(backup.id, senha)
          .then((r) =>
            onRestaurado(
              `Backup restaurado (${r.tabelas} tabelas). O estado anterior foi guardado em ${r.backupSeguranca}. Se alguém estiver com o painel aberto, precisa recarregar a página.`,
            ),
          )
          .catch((e: unknown) =>
            setErro(e instanceof ErroDaApi || e instanceof Error ? e.message : 'Falhou.'),
          )
          .finally(() => setEnviando(false));
      }}
    >
      {backup && (
        <>
          <p className="alerta alerta--erro">
            Todos os dados atuais serão substituídos pelos do backup de{' '}
            <strong>{quando(backup.iniciadoEm)}</strong>. Entradas, saídas e pagamentos feitos depois disso
            deixam de existir.
          </p>
          <ul className="lista-simples">
            <li>Antes, o sistema faz um backup de segurança do estado atual (para desfazer, se preciso).</li>
            <li>Durante a restauração (alguns minutos), o painel fica indisponível para todos.</li>
            <li>O app do cliente é atualizado sozinho depois.</li>
          </ul>
          <label className="campo">
            <span>Sua senha</span>
            <input
              type="password"
              autoComplete="current-password"
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
          </label>
          <label className="campo">
            <span>Digite RESTAURAR para confirmar</span>
            <input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
          </label>
        </>
      )}
    </Dialogo>
  );
}
