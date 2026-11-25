import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { AtividadeRegistrada, FuncionarioResumo } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { BotoesExportar } from '../components/BotoesExportar';
import { ErroDaApi } from '../services/api';
import { MODULOS_HISTORICO, ROTULOS_ACOES, formatarDataHora } from '../services/rotulos';
import { usuariosApi } from '../services/usuarios';

type Valor = string | number | boolean | null | undefined;

/** Campos técnicos que não ajudam quem lê o histórico. */
const OCULTOS = new Set(['userAgent', 'usuario_id', 'regras']);
/** Campos 0/1 que devem aparecer como sim/não. */
const BOOLEANOS = new Set(['ativo', 'permite_troco', 'coberta', 'deve_trocar_senha']);
const NIVEIS: Record<string, string> = {
  '00000000000000000000000001': 'Administrador',
  '00000000000000000000000004': 'Operador',
  '00000000000000000000000005': 'Gerente',
};
const NOMES_CAMPOS: Record<string, string> = {
  perfil_id: 'nível',
  data_desligamento: 'desligamento',
  data_admissao: 'admissão',
  bloqueado_ate: 'bloqueado até',
  valor_final: 'valor final',
};

function formatarValor(campo: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (BOOLEANOS.has(campo) || typeof v === 'boolean') return Number(v) ? 'sim' : 'não';
  if (campo === 'perfil_id' && typeof v === 'string') return NIVEIS[v] ?? v;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Resume o que mudou: "campo: antes → depois" ou os dados registrados. */
function resumir(a: AtividadeRegistrada): string[] {
  const antes = (a.dadosAnteriores ?? {}) as Record<string, Valor>;
  const depois = (a.dadosNovos ?? {}) as Record<string, Valor>;
  const nome = (k: string) => NOMES_CAMPOS[k] ?? k;
  if (a.dadosAnteriores && a.dadosNovos) {
    return Object.keys(depois)
      .filter((k) => !OCULTOS.has(k) && JSON.stringify(antes[k]) !== JSON.stringify(depois[k]))
      .map((k) => `${nome(k)}: ${formatarValor(k, antes[k])} → ${formatarValor(k, depois[k])}`);
  }
  const base = a.dadosNovos ? depois : antes;
  return Object.entries(base)
    .filter(([k]) => !OCULTOS.has(k))
    .slice(0, 6)
    .map(([k, v]) => `${nome(k)}: ${formatarValor(k, v)}`);
}

export function Atividades() {
  const { temPermissao } = useAuth();
  const [params, setParams] = useSearchParams();
  const filtro = {
    usuarioId: params.get('usuarioId') ?? '',
    modulo: params.get('modulo') ?? '',
    de: params.get('de') ?? '',
    ate: params.get('ate') ?? '',
    horaDe: params.get('horaDe') ?? '',
    horaAte: params.get('horaAte') ?? '',
  };
  const chave = params.toString();

  const [itens, setItens] = useState<AtividadeRegistrada[]>([]);
  const [proxima, setProxima] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [usuarios, setUsuarios] = useState<FuncionarioResumo[]>([]);

  const consultar = useCallback(
    (antesDe?: string) =>
      usuariosApi.atividades({ ...Object.fromEntries(new URLSearchParams(chave)), antesDe, limite: '50' }),
    [chave],
  );
  const mensagemErro = (e: unknown) => (e instanceof ErroDaApi ? e.message : 'Erro ao carregar o histórico');

  // Primeira página: recarrega quando os filtros (URL) mudam. `ativo` descarta
  // respostas atrasadas de filtros anteriores.
  useEffect(() => {
    let ativo = true;
    consultar()
      .then((pagina) => {
        if (!ativo) return;
        setItens(pagina.itens);
        setProxima(pagina.proximaPagina);
        setErro(null);
      })
      .catch((e: unknown) => {
        if (ativo) setErro(mensagemErro(e));
      })
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [consultar]);

  async function carregarMais(antesDe: string) {
    setCarregando(true);
    try {
      const pagina = await consultar(antesDe);
      setItens((atual) => [...atual, ...pagina.itens]);
      setProxima(pagina.proximaPagina);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (!temPermissao('usuario.gerenciar', 'funcionario.gerenciar')) return;
    usuariosApi
      .listar({ situacao: 'todos' })
      .then((r) => setUsuarios(r.itens.filter((u) => u.acesso)))
      .catch(() => undefined);
  }, [temPermissao]);

  const mudar = (campo: keyof typeof filtro, valor: string) => {
    setCarregando(true);
    const novo = new URLSearchParams(params);
    if (valor) novo.set(campo, valor);
    else novo.delete(campo);
    setParams(novo, { replace: true });
  };

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Auditoria</h1>
          <p className="mudo">
            Quem fez o quê e quando: logins, entradas, saídas, tarifas, caixa, funcionários, configurações e
            tentativas de acesso sem permissão. Somente consulta: ninguém altera nem apaga estes registros (o
            banco também recusa).
          </p>
        </div>
        <BotoesExportar
          nome="auditoria"
          desabilitado={!itens.length}
          abas={() => [
            {
              nome: 'Auditoria',
              cabecalho: ['Data e hora', 'Funcionário', 'Ação', 'Registro', 'Detalhes', 'Motivo', 'IP'],
              linhas: itens.map((a) => [
                formatarDataHora(a.criadoEm),
                a.usuario?.nome ?? 'Sistema',
                ROTULOS_ACOES[a.acao] ?? a.acao,
                [a.entidade, a.entidadeId].filter(Boolean).join(' '),
                resumir(a).join('; '),
                a.motivo,
                a.ip,
              ]),
            },
          ]}
        />
      </header>

      <div className="filtros cartao">
        <label className="campo">
          <span>Tipo</span>
          <select value={filtro.modulo} onChange={(e) => mudar('modulo', e.target.value)}>
            <option value="">Todos</option>
            {MODULOS_HISTORICO.map((m) => (
              <option key={m.codigo} value={m.codigo}>
                {m.nome}
              </option>
            ))}
          </select>
        </label>
        {usuarios.length > 0 && (
          <label className="campo">
            <span>Usuário</span>
            <select value={filtro.usuarioId} onChange={(e) => mudar('usuarioId', e.target.value)}>
              <option value="">Todos</option>
              {usuarios.map((u) => (
                <option key={u.acesso!.usuarioId} value={u.acesso!.usuarioId}>
                  {u.nome}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="campo">
          <span>De</span>
          <input type="date" value={filtro.de} onChange={(e) => mudar('de', e.target.value)} />
        </label>
        <label className="campo">
          <span>Até</span>
          <input type="date" value={filtro.ate} onChange={(e) => mudar('ate', e.target.value)} />
        </label>
        <label className="campo">
          <span>Das (hora)</span>
          <input type="time" value={filtro.horaDe} onChange={(e) => mudar('horaDe', e.target.value)} />
        </label>
        <label className="campo">
          <span>Até (hora)</span>
          <input type="time" value={filtro.horaAte} onChange={(e) => mudar('horaAte', e.target.value)} />
        </label>
        {chave && (
          <button
            type="button"
            className="botao-texto"
            onClick={() => {
              setCarregando(true);
              setParams({}, { replace: true });
            }}
          >
            Limpar filtros
          </button>
        )}
      </div>

      <section className="cartao">
        {erro && <p className="alerta alerta--erro">{erro}</p>}
        {!carregando && !erro && itens.length === 0 && <p className="mudo">Nenhuma atividade encontrada.</p>}
        {itens.length > 0 && (
          <div className="tabela-rolagem">
            <table className="tabela tabela--historico">
              <thead>
                <tr>
                  <th>Data e hora</th>
                  <th>Usuário</th>
                  <th>Atividade</th>
                  <th>Detalhes</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((a) => (
                  <tr key={a.id}>
                    <td className="sem-quebra">{formatarDataHora(a.criadoEm)}</td>
                    <td>{a.usuario?.nome ?? <span className="mudo">Sistema</span>}</td>
                    <td>
                      {ROTULOS_ACOES[a.acao] ?? a.acao}
                      {a.motivo && <div className="mudo">Motivo: {a.motivo}</div>}
                    </td>
                    <td className="detalhes">
                      {resumir(a).map((linha) => (
                        <div key={linha}>{linha}</div>
                      ))}
                      {a.ip && <div className="mudo">IP {a.ip}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {carregando && <p className="mudo">Carregando…</p>}
        {proxima && !carregando && (
          <div className="acoes">
            <button
              type="button"
              className="botao botao--secundario"
              onClick={() => {
                void carregarMais(proxima);
              }}
            >
              Carregar mais
            </button>
          </div>
        )}
      </section>
    </>
  );
}
