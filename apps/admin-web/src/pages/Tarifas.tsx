import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  Categoria,
  RegraCadastrada,
  TabelaTarifaDetalhe,
  TabelaTarifaResumo,
  TipoRegra,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import { CartaoCategoria } from '../components/tarifas/CartaoCategoria';
import { DialogoRegra } from '../components/tarifas/DialogoRegra';
import { Simulador } from '../components/tarifas/Simulador';
import { CLASSE_SITUACAO, diferencas, ROTULO_SITUACAO } from '../components/tarifas/util';
import { mensagemDeErro } from '../components/vagas/Dialogos';
import { useCarregar } from '../hooks/useCarregar';
import { formatarDataHora } from '../services/rotulos';
import { tarifasApi } from '../services/tarifas';
import { vagasApi } from '../services/vagas';

type Aba = 'vigor' | 'edicao' | 'historico';
type Edicao = { regra: RegraCadastrada | null; nova: { categoriaId: string; tipo: TipoRegra } | null };

/** Agrupa as regras por categoria, incluindo categorias ativas ainda sem preço. */
function porCategoria(t: TabelaTarifaDetalhe, categorias: Categoria[]) {
  const grupos = new Map<string, { nome: string; regras: RegraCadastrada[] }>();
  for (const c of categorias.filter((x) => x.ativo)) grupos.set(c.id, { nome: c.nome, regras: [] });
  for (const r of t.regras) {
    const g = grupos.get(r.categoriaId) ?? { nome: r.categoria, regras: [] };
    g.regras.push(r);
    grupos.set(r.categoriaId, g);
  }
  return [...grupos.entries()];
}

export function Tarifas() {
  const { temPermissao } = useAuth();
  const podeEditar = temPermissao('tarifa.gerenciar');
  const podePublicar = temPermissao('tarifa.publicar');
  const carregar = useCallback(() => tarifasApi.painel(), []);
  const painel = useCarregar(carregar);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [aba, setAba] = useState<Aba>('vigor');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const [vendo, setVendo] = useState<TabelaTarifaDetalhe | null>(null);
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens))
      .catch(() => undefined);
  }, []);

  const p = painel.dados;
  const rascunho = p?.rascunho ?? null;
  const vigente = p?.vigente ?? null;

  const executar = async (acao: () => Promise<unknown>, ok: string, irPara?: Aba) => {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao();
      setMensagem({ tipo: 'ok', texto: ok });
      painel.recarregar();
      if (irPara) setAba(irPara);
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  const novaVersao = (baseId?: string) =>
    executar(
      () => tarifasApi.novaVersao({ baseId }),
      'Nova versão criada a partir dos preços atuais. Altere o que precisar e publique quando estiver pronta.',
      'edicao',
    );

  const alternar = (r: RegraCadastrada) =>
    executar(
      () => tarifasApi.salvarRegra(rascunho!.id, r.id, { ...r, ativo: !r.ativo }),
      `${r.tipo === 'PADRAO' ? `Tarifa padrão de ${r.categoria}` : `"${r.nome}"`} ${r.ativo ? 'desativada' : 'reativada'} nesta versão.`,
    );

  const remover = (r: RegraCadastrada) =>
    executar(() => tarifasApi.removerRegra(rascunho!.id, r.id), `"${r.nome}" removida desta versão.`);

  const abaAtual: Aba = aba === 'edicao' && !rascunho ? 'vigor' : aba;

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Tarifas</h1>
          <p className="mudo">
            Preços por categoria, regras de arredondamento e tarifas especiais. Cada mudança vira uma nova
            versão: quem já entrou paga pela tarifa da entrada.
          </p>
        </div>
        {podeEditar && !rascunho && p && (
          <button type="button" className="botao" onClick={() => void novaVersao()} disabled={ocupado}>
            Alterar preços
          </button>
        )}
      </header>

      {mensagem && (
        <p className={`alerta alerta--${mensagem.tipo}`} role="status">
          {mensagem.texto}
        </p>
      )}
      {painel.erro && (
        <p className="alerta alerta--erro" role="alert">
          {painel.erro.message}
        </p>
      )}

      <div className="abas abas--pagina" role="tablist">
        {(
          [
            ['vigor', 'Em vigor'],
            ...(rascunho ? [['edicao', `Nova versão (v${rascunho.versao})`]] : []),
            ['historico', 'Histórico de versões'],
          ] as [Aba, string][]
        ).map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={abaAtual === id}
            className={abaAtual === id ? 'aba aba--ativa' : 'aba'}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </div>

      {!p && painel.carregando && <p className="mudo">Carregando…</p>}

      {p && abaAtual === 'vigor' && (
        <>
          {p.agendadas.map((t) => (
            <p key={t.id} className="alerta alerta--info">
              A versão {t.versao} (“{t.nome}”) entra em vigor em{' '}
              <strong>{formatarDataHora(t.vigenteDesde)}</strong>.{' '}
              <button
                type="button"
                className="botao-texto"
                onClick={() => void tarifasApi.obter(t.id).then(setVendo)}
              >
                Ver preços
              </button>
              {podePublicar && (
                <>
                  {' · '}
                  <button
                    type="button"
                    className="botao-texto"
                    onClick={() =>
                      void executar(
                        () => tarifasApi.arquivar(t.id),
                        `Agendamento da versão ${t.versao} cancelado.`,
                      )
                    }
                  >
                    Cancelar agendamento
                  </button>
                </>
              )}
            </p>
          ))}
          {vigente ? (
            <>
              <CabecalhoVersao t={vigente} />
              <div className="grade-tarifas">
                {porCategoria(vigente, categorias).map(([id, g]) => (
                  <CartaoCategoria key={id} categoriaId={id} categoria={g.nome} regras={g.regras} />
                ))}
              </div>
            </>
          ) : (
            <p className="alerta alerta--erro">
              Nenhuma tabela de tarifas em vigor: as entradas são recusadas até uma versão ser publicada.
              {rascunho
                ? ' Termine a nova versão e publique.'
                : ' Clique em “Alterar preços” para cadastrar.'}
            </p>
          )}
          <Simulador vigente={vigente} rascunho={rascunho} />
        </>
      )}

      {p && abaAtual === 'edicao' && rascunho && (
        <>
          <EdicaoCabecalho
            t={rascunho}
            podeEditar={podeEditar}
            onSalvo={(texto) => {
              setMensagem({ tipo: 'ok', texto });
              painel.recarregar();
            }}
          />
          <MudancasEPublicacao
            vigente={vigente}
            rascunho={rascunho}
            podePublicar={podePublicar}
            podeEditar={podeEditar}
            onPublicar={() => setPublicando(true)}
            onDescartar={() => setDescartando(true)}
          />
          <div className="grade-tarifas">
            {porCategoria(rascunho, categorias).map(([id, g]) => (
              <CartaoCategoria
                key={id}
                categoriaId={id}
                categoria={g.nome}
                regras={g.regras}
                acoes={
                  podeEditar
                    ? {
                        onEditar: (r) => setEdicao({ regra: r, nova: null }),
                        onAlternar: (r) => void alternar(r),
                        onRemover: (r) => void remover(r),
                        onNovaEspecial: (categoriaId) =>
                          setEdicao({ regra: null, nova: { categoriaId, tipo: 'ESPECIAL' } }),
                        onDefinirPadrao: (categoriaId) =>
                          setEdicao({ regra: null, nova: { categoriaId, tipo: 'PADRAO' } }),
                      }
                    : undefined
                }
              />
            ))}
          </div>
          <Simulador vigente={vigente} rascunho={rascunho} />
        </>
      )}

      {p && abaAtual === 'historico' && (
        <Historico
          itens={p.historico}
          podeEditar={podeEditar && !rascunho}
          onVer={(id) => void tarifasApi.obter(id).then(setVendo)}
          onBase={(id) => void novaVersao(id)}
        />
      )}

      {edicao && rascunho && (
        <DialogoRegra
          tabelaId={rascunho.id}
          regra={edicao.regra}
          nova={edicao.nova}
          categorias={categorias}
          modelo={rascunho.regras.find(
            (r) =>
              r.tipo === 'PADRAO' &&
              r.categoriaId === (edicao.regra?.categoriaId ?? edicao.nova?.categoriaId),
          )}
          onFechar={() => setEdicao(null)}
          onSalvo={() => {
            setEdicao(null);
            setMensagem({
              tipo: 'ok',
              texto: 'Tarifa salva na nova versão. Ela só passa a valer quando for publicada.',
            });
            painel.recarregar();
          }}
        />
      )}
      {publicando && rascunho && (
        <DialogoPublicar
          vigente={vigente}
          rascunho={rascunho}
          onFechar={() => setPublicando(false)}
          onPublicado={(texto) => {
            setPublicando(false);
            setMensagem({ tipo: 'ok', texto });
            setAba('vigor');
            painel.recarregar();
          }}
        />
      )}
      {descartando && rascunho && (
        <Dialogo
          aberto
          titulo={`Descartar a versão ${rascunho.versao}?`}
          textoConfirmar="Descartar"
          perigo
          enviando={ocupado}
          onFechar={() => setDescartando(false)}
          onConfirmar={() =>
            void executar(
              () => tarifasApi.descartar(rascunho.id),
              'Nova versão descartada. Os preços em vigor não mudaram.',
              'vigor',
            ).then(() => setDescartando(false))
          }
        >
          <p className="mudo">
            As alterações feitas nesta versão serão perdidas. Os preços em vigor continuam os mesmos.
          </p>
        </Dialogo>
      )}
      {vendo && <DialogoVersao t={vendo} categorias={categorias} onFechar={() => setVendo(null)} />}
    </>
  );
}

function CabecalhoVersao({ t }: { t: TabelaTarifaResumo }) {
  return (
    <div className="versao-tarifa">
      <span className={`etiqueta ${CLASSE_SITUACAO[t.situacao]}`}>{ROTULO_SITUACAO[t.situacao]}</span>
      <strong>
        Versão {t.versao} · {t.nome}
      </strong>
      {t.vigenteDesde && <span className="mudo">valendo desde {formatarDataHora(t.vigenteDesde)}</span>}
      {t.publicadoPor && <span className="mudo">publicada por {t.publicadoPor}</span>}
      <span className="mudo">{t.ticketsUsaram} ticket(s) cobrados por ela</span>
    </div>
  );
}

function EdicaoCabecalho({
  t,
  podeEditar,
  onSalvo,
}: {
  t: TabelaTarifaDetalhe;
  podeEditar: boolean;
  onSalvo: (msg: string) => void;
}) {
  const [nome, setNome] = useState(t.nome);
  const [descricao, setDescricao] = useState(t.descricao ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const mudou = nome !== t.nome || descricao !== (t.descricao ?? '');
  return (
    <form
      className="cartao filtros"
      onSubmit={(e) => {
        e.preventDefault();
        tarifasApi
          .renomear(t.id, { nome, descricao: descricao || null })
          .then(() => onSalvo('Nome da versão salvo.'))
          .catch((x) => setErro(mensagemDeErro(x)));
      }}
    >
      <label className="campo campo--crescer">
        <span>Nome da versão</span>
        <input
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          maxLength={80}
          required
          disabled={!podeEditar}
        />
      </label>
      <label className="campo campo--crescer">
        <span>Observação</span>
        <input
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          maxLength={255}
          disabled={!podeEditar}
        />
      </label>
      {podeEditar && (
        <button type="submit" className="botao botao--secundario" disabled={!mudou}>
          Salvar nome
        </button>
      )}
      {erro && <p className="alerta alerta--erro">{erro}</p>}
    </form>
  );
}

function MudancasEPublicacao({
  vigente,
  rascunho,
  podePublicar,
  podeEditar,
  onPublicar,
  onDescartar,
}: {
  vigente: TabelaTarifaDetalhe | null;
  rascunho: TabelaTarifaDetalhe;
  podePublicar: boolean;
  podeEditar: boolean;
  onPublicar: () => void;
  onDescartar: () => void;
}) {
  const mudancas = diferencas(vigente, rascunho);
  return (
    <section className="cartao" aria-labelledby="titulo-mudancas">
      <div className="cartao__topo">
        <h2 id="titulo-mudancas">O que muda {vigente ? `em relação à versão ${vigente.versao}` : ''}</h2>
        <div className="acoes acoes--quebrar">
          {podeEditar && (
            <button type="button" className="botao-texto botao-texto--perigo" onClick={onDescartar}>
              Descartar versão
            </button>
          )}
          {podePublicar && (
            <button type="button" className="botao" onClick={onPublicar} disabled={mudancas.length === 0}>
              Publicar versão {rascunho.versao}…
            </button>
          )}
        </div>
      </div>
      {mudancas.length ? (
        <ul className="lista-mudancas">
          {mudancas.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : (
        <p className="mudo">
          Nenhuma diferença ainda. Edite uma tarifa ou cadastre uma tarifa especial abaixo.
        </p>
      )}
      {!podePublicar && (
        <p className="pequeno mudo">Publicar exige a permissão “Publicar e arquivar tabelas de tarifa”.</p>
      )}
    </section>
  );
}

function DialogoPublicar({
  vigente,
  rascunho,
  onFechar,
  onPublicado,
}: {
  vigente: TabelaTarifaDetalhe | null;
  rascunho: TabelaTarifaDetalhe;
  onFechar: () => void;
  onPublicado: (msg: string) => void;
}) {
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora');
  const [data, setData] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const mudancas = diferencas(vigente, rascunho);

  async function publicar() {
    const inicio = quando === 'agendar' ? (data ? new Date(data) : null) : null;
    if (quando === 'agendar' && (!inicio || Number.isNaN(inicio.getTime())))
      return setErro('Informe a data e a hora de início.');
    setEnviando(true);
    setErro(null);
    try {
      await tarifasApi.publicar(rascunho.id, inicio ? inicio.toISOString() : null);
      onPublicado(
        inicio
          ? `Versão ${rascunho.versao} agendada para ${formatarDataHora(inicio.toISOString())}. Até lá, valem os preços atuais.`
          : `Versão ${rascunho.versao} publicada e em vigor. Os veículos que já estavam no estacionamento continuam com a tarifa da entrada.`,
      );
    } catch (e) {
      setErro(mensagemDeErro(e));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialogo
      aberto
      titulo={`Publicar a versão ${rascunho.versao}`}
      textoConfirmar={quando === 'agora' ? 'Publicar agora' : 'Agendar'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void publicar()}
    >
      <ul className="lista-mudancas lista-mudancas--curta">
        {mudancas.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <div className="opcoes-linha" role="radiogroup" aria-label="Quando começa a valer">
        <label className="opcao opcao--compacta">
          <input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} />
          Começa a valer agora
        </label>
        <label className="opcao opcao--compacta">
          <input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} />
          Agendar
        </label>
      </div>
      {quando === 'agendar' && (
        <label className="campo">
          <span>Início da vigência</span>
          <input type="datetime-local" value={data} onChange={(e) => setData(e.target.value)} required />
        </label>
      )}
      <p className="alerta alerta--info">
        Tickets abertos e já encerrados não mudam: cada um guarda a tarifa da entrada. Depois de publicada,
        esta versão não pode mais ser alterada — para mudar de novo, crie outra versão.
      </p>
    </Dialogo>
  );
}

function Historico({
  itens,
  podeEditar,
  onVer,
  onBase,
}: {
  itens: TabelaTarifaResumo[];
  podeEditar: boolean;
  onVer: (id: string) => void;
  onBase: (id: string) => void;
}) {
  if (!itens.length) return <p className="mudo">Nenhuma versão publicada ainda.</p>;
  return (
    <section className="cartao">
      <div className="tabela-rolagem">
        <table className="tabela tabela--compacta">
          <thead>
            <tr>
              <th scope="col">Versão</th>
              <th scope="col">Nome</th>
              <th scope="col">Situação</th>
              <th scope="col">Início da vigência</th>
              <th scope="col">Publicada por</th>
              <th scope="col" className="numero">
                Tickets
              </th>
              <th scope="col">
                <span className="sr-only">Ações</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((t) => (
              <tr key={t.id}>
                <td>v{t.versao}</td>
                <td>{t.nome}</td>
                <td>
                  <span className={`etiqueta ${CLASSE_SITUACAO[t.situacao]}`}>
                    {ROTULO_SITUACAO[t.situacao]}
                  </span>
                </td>
                <td className="sem-quebra">{formatarDataHora(t.vigenteDesde)}</td>
                <td>{t.publicadoPor ?? '—'}</td>
                <td className="numero">{t.ticketsUsaram}</td>
                <td>
                  <div className="acoes acoes--tabela">
                    <button
                      type="button"
                      className="botao botao--secundario botao--pequeno"
                      onClick={() => onVer(t.id)}
                    >
                      Ver preços
                    </button>
                    {podeEditar && (
                      <button
                        type="button"
                        className="botao-texto"
                        onClick={() => onBase(t.id)}
                        title="Cria uma nova versão com os preços desta"
                      >
                        Usar como base
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="pequeno mudo">
        Versões publicadas nunca são alteradas nem apagadas: cada ticket continua ligado à versão com que foi
        cobrado.
      </p>
    </section>
  );
}

function DialogoVersao({
  t,
  categorias,
  onFechar,
}: {
  t: TabelaTarifaDetalhe;
  categorias: Categoria[];
  onFechar: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialogo dialogo--largo" onClose={onFechar} aria-labelledby="versao-titulo">
      <h2 id="versao-titulo">
        Versão {t.versao} · {t.nome}
      </h2>
      <CabecalhoVersao t={t} />
      <div className="grade-tarifas grade-tarifas--dialogo">
        {porCategoria(t, categorias)
          .filter(([, g]) => g.regras.length)
          .map(([id, g]) => (
            <CartaoCategoria key={id} categoriaId={id} categoria={g.nome} regras={g.regras} />
          ))}
      </div>
      <div className="acoes acoes--direita">
        <button type="button" className="botao" onClick={() => ref.current?.close()} autoFocus>
          Fechar
        </button>
      </div>
    </dialog>
  );
}
