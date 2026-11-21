import { useCallback, useEffect, useState } from 'react';
import {
  monitoramentoApi,
  type Componente,
  type Nivel,
  type PainelMonitoramento,
} from '../services/monitoramento';

const INTERVALO_MS = 15_000;
const quando = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }) : '—';
const ROTULO_NIVEL: Record<Nivel, string> = {
  OK: 'Funcionando',
  ATENCAO: 'Atenção',
  FALHA: 'Falha',
  DESLIGADO: 'Desligado',
};
const ICONE: Record<Nivel, string> = { OK: '✓', ATENCAO: '!', FALHA: '✕', DESLIGADO: '–' };

const TITULOS: { chave: keyof PainelMonitoramento['componentes']; titulo: string }[] = [
  { chave: 'servidor', titulo: 'Servidor local' },
  { chave: 'banco', titulo: 'Banco de dados' },
  { chave: 'internet', titulo: 'Internet' },
  { chave: 'apiExterna', titulo: 'API externa (nuvem)' },
  { chave: 'sincronizacao', titulo: 'Sincronização' },
  { chave: 'backup', titulo: 'Backup' },
];

/** Nomes legíveis para os detalhes técnicos de cada componente. */
const ROTULOS: Record<string, string> = {
  computador: 'Computador',
  versao: 'Versão',
  ambiente: 'Ambiente',
  https: 'HTTPS',
  noArDesde: 'No ar desde',
  memoriaProcessoMb: 'Memória do sistema (MB)',
  memoriaLivrePct: 'Memória livre do PC (%)',
  cargaCpu: 'Carga do processador',
  discoLivreGb: 'Disco livre (GB)',
  computadorLigadoHa: 'PC ligado há',
  node: 'Node.js',
  banco: 'Banco',
  latenciaMs: 'Tempo de resposta (ms)',
  tamanhoMb: 'Tamanho (MB)',
  conexoes: 'Conexões abertas',
  verificado: 'Verificado com',
  endereco: 'Endereço',
  httpStatus: 'HTTP',
  status: 'Status',
  erro: 'Erro',
  pendentes: 'Registros pendentes',
  deteccoesPendentes: 'Alterações detectadas pendentes',
  pendenteMaisAntigoEm: 'Pendente mais antigo',
  recusados: 'Recusados pela nuvem',
  ultimaSincronizacaoEm: 'Última sincronização',
  ultimoContatoEm: 'Último contato',
  ultimaConferenciaEm: 'Última conferência',
  falhasSeguidas: 'Falhas seguidas',
  ultimoErro: 'Último erro',
  ultimoSucessoEm: 'Último backup',
  ultimaFalhaEm: 'Última falha',
  proximoEm: 'Próximo',
  guardados: 'Guardados',
  segundaCopia: 'Segunda cópia',
};
function valor(chave: string, v: string | number | boolean | null): string {
  if (v === null || v === '') return '—';
  if (typeof v === 'boolean') return v ? 'Sim' : 'Não';
  if (typeof v === 'string' && /Em$|Desde$/.test(chave) && !Number.isNaN(Date.parse(v))) return quando(v);
  return String(v);
}

function Indicador({ nivel }: { nivel: Nivel }) {
  return (
    <span className={`mon-nivel mon-nivel--${nivel.toLowerCase()}`}>
      <span aria-hidden="true">{ICONE[nivel]}</span> {ROTULO_NIVEL[nivel]}
    </span>
  );
}

function Cartao({ titulo, c }: { titulo: string; c: Componente }) {
  return (
    <article className={`mon-cartao mon-cartao--${c.nivel.toLowerCase()}`}>
      <header>
        <h2>{titulo}</h2>
        <Indicador nivel={c.nivel} />
      </header>
      <p className="mon-resumo">{c.resumo}</p>
      {c.acao && <p className="mon-acao">{c.acao}</p>}
      <details>
        <summary>Detalhes</summary>
        <dl className="detalhes-sync">
          {Object.entries(c.detalhes).map(([k, v]) => (
            <div key={k}>
              <dt>{ROTULOS[k] ?? k}</dt>
              <dd>{valor(k, v)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

/** Monitoramento técnico: estado de cada parte do sistema, com atualização automática. */
export function Monitoramento() {
  const [p, setP] = useState<PainelMonitoramento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(
    (forcar = false) =>
      monitoramentoApi
        .painel(forcar)
        .then(
          (r) => {
            setP(r);
            setErro(null);
          },
          // Se nem o painel responde, o próprio servidor local está fora do ar
          (e: unknown) => setErro(e instanceof Error ? e.message : 'Servidor local sem resposta.'),
        )
        .finally(() => setCarregando(false)),
    [],
  );
  useEffect(() => {
    void carregar();
    if (!auto) return;
    const t = setInterval(() => void carregar(), INTERVALO_MS);
    return () => clearInterval(t);
  }, [carregar, auto]);

  const geral = erro ? 'FALHA' : (p?.geral ?? null);
  return (
    <section className="cartao">
      <div className="mon-topo">
        <h1>Monitoramento do sistema</h1>
        <div className="mon-controles">
          <label>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Atualizar a
            cada {INTERVALO_MS / 1000} s
          </label>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => {
              setCarregando(true);
              void carregar(true);
            }}
            disabled={carregando}
          >
            {carregando ? 'Verificando…' : 'Verificar agora'}
          </button>
        </div>
      </div>

      {geral && (
        <div className={`mon-geral mon-geral--${geral.toLowerCase()}`} role="status" aria-live="polite">
          <span className="mon-geral-icone" aria-hidden="true">
            {ICONE[geral]}
          </span>
          <div>
            <strong>
              {erro
                ? 'Servidor local sem resposta'
                : geral === 'OK'
                  ? 'Tudo funcionando'
                  : geral === 'FALHA'
                    ? 'Há falhas que podem afetar a operação'
                    : 'Há pontos de atenção'}
            </strong>
            <span className="pequeno">{erro ?? `Verificado em ${quando(p?.geradoEm)}`}</span>
          </div>
        </div>
      )}

      {p && p.alertas.length > 0 && (
        <ul className="mon-alertas">
          {p.alertas.map((a, i) => (
            <li key={i} className={`mon-alerta mon-alerta--${a.nivel.toLowerCase()}`}>
              <Indicador nivel={a.nivel} /> <strong>{a.componente}:</strong> {a.mensagem}
              {a.acao && <div className="pequeno">{a.acao}</div>}
            </li>
          ))}
        </ul>
      )}

      {p && (
        <>
          <div className="mon-grade">
            {TITULOS.map((t) => (
              <Cartao key={t.chave} titulo={t.titulo} c={p.componentes[t.chave]} />
            ))}
          </div>

          <div className="mon-numeros">
            <div>
              <span className="mon-numero">
                {Number(p.componentes.sincronizacao.detalhes.pendentes ?? 0)}
              </span>
              <span className="pequeno">registros pendentes de envio</span>
            </div>
            <div>
              <span className="mon-numero">
                {quando(p.componentes.sincronizacao.detalhes.ultimaSincronizacaoEm as string | null)}
              </span>
              <span className="pequeno">última sincronização</span>
            </div>
            <div>
              <span className="mon-numero">{p.contagens.falhasSyncUltimas24h}</span>
              <span className="pequeno">falhas de comunicação (24 h)</span>
            </div>
            <div>
              <span className="mon-numero">{p.contagens.errosUltimas24h}</span>
              <span className="pequeno">erros internos (24 h)</span>
            </div>
          </div>

          <h2>Falhas de comunicação com a nuvem</h2>
          {p.falhasComunicacao.length === 0 ? (
            <p className="pequeno">Nenhuma falha registrada.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Operação</th>
                    <th>HTTP</th>
                    <th>Erro</th>
                  </tr>
                </thead>
                <tbody>
                  {p.falhasComunicacao.map((f, i) => (
                    <tr key={i}>
                      <td>{quando(f.em)}</td>
                      <td>{f.tipo}</td>
                      <td>{f.httpStatus ?? '—'}</td>
                      <td>{f.erro ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>Erros recentes</h2>
          {p.errosRecentes.length === 0 ? (
            <p className="pequeno">Nenhum erro interno registrado.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Origem</th>
                    <th>Código</th>
                    <th>Onde</th>
                    <th>Mensagem</th>
                  </tr>
                </thead>
                <tbody>
                  {p.errosRecentes.map((e, i) => (
                    <tr key={i}>
                      <td>{quando(e.em)}</td>
                      <td>{e.origem === 'API' ? 'Requisição' : 'Processo'}</td>
                      <td>{e.codigo ?? '—'}</td>
                      <td>{e.rota ?? '—'}</td>
                      <td>{e.mensagem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
