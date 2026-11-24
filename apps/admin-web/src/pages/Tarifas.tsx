import { useCallback, useEffect, useState } from 'react';
import {
  centavosParaCampo,
  descreverCondicao,
  formatarCentavos,
  lerCentavos,
  type Categoria,
  type DadosRegra,
  type RegraCadastrada,
  type TabelaTarifaDetalhe,
  type TipoRegra,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { Dialogo } from '../components/Dialogo';
import {
  IconeCalculadora,
  IconeCarro,
  IconeEtiqueta,
  IconeHistorico,
  IconeLapis,
  IconeLixeira,
  IconeLua,
  IconeMais,
  IconeMoto,
  IconeRelogio,
  IconeSalvar,
  IconeSol,
} from '../components/Icones';
import { DialogoRegra } from '../components/tarifas/DialogoRegra';
import { Simulador } from '../components/tarifas/Simulador';
import {
  alteracoes,
  CLASSE_SITUACAO,
  linhasDaRegra,
  ROTULO_SITUACAO,
  type Alteracao,
} from '../components/tarifas/util';
import { mensagemDeErro } from '../components/vagas/Dialogos';
import { useCarregar } from '../hooks/useCarregar';
import { formatarDataHora } from '../services/rotulos';
import { tarifasApi } from '../services/tarifas';
import { vagasApi } from '../services/vagas';

/**
 * Tarifas por categoria (Carro, Moto...), cada uma independente.
 * Por baixo continua o controle de versões: toda alteração fica numa versão
 * "em edição" e só passa a valer em "Salvar alterações" (publicar). Quem já
 * entrou paga pela tarifa da entrada.
 */
interface Campos {
  primeira: string;
  adicional: string;
  diaria: string;
  teto: string;
}
type EdicaoRegra = {
  tabelaId: string;
  regra: RegraCadastrada | null;
  nova: { categoriaId: string; tipo: TipoRegra } | null;
  modelo?: RegraCadastrada;
  /** A versão em edição foi criada só para abrir este diálogo: se cancelar, é descartada. */
  criouRascunho: boolean;
};
type LinhaHistorico = Alteracao & { em: string; por: string | null; versao: number };

const campo = (v: number | null | undefined) => (v === null || v === undefined ? '' : centavosParaCampo(v));
const camposDe = (r: RegraCadastrada | undefined): Campos => ({
  primeira: campo(r?.primeiraHoraCentavos),
  adicional: campo(r?.horaAdicionalCentavos),
  diaria: campo(r?.diariaCentavos),
  teto: campo(r?.diariaMaximaCentavos),
});
const chave = (r: RegraCadastrada) => `${r.categoriaId}|${r.tipo}|${r.nome ?? ''}`;
const padraoDe = (t: TabelaTarifaDetalhe | null, categoriaId: string) =>
  t?.regras.find((r) => r.categoriaId === categoriaId && r.tipo === 'PADRAO');
const periodosDe = (t: TabelaTarifaDetalhe | null, categoriaId: string) =>
  (t?.regras ?? []).filter((r) => r.categoriaId === categoriaId && r.tipo === 'ESPECIAL');

/** Valor principal de um período: preço fixo ou 1ª hora. */
const valorDoPeriodo = (r: RegraCadastrada) =>
  r.valorFixoCentavos !== null
    ? formatarCentavos(r.valorFixoCentavos)
    : `${formatarCentavos(r.primeiraHoraCentavos)} 1ª h + ${formatarCentavos(r.horaAdicionalCentavos)}/h`;
const horarioDoPeriodo = (r: RegraCadastrada) =>
  r.aplicacao === 'MANUAL'
    ? 'Escolhida na entrada'
    : r.horaInicio
      ? descreverCondicao(r)
      : r.diasSemana === null || r.diasSemana === 127
        ? 'Qualquer horário'
        : descreverCondicao(r);
function IconePeriodo({ r }: { r: RegraCadastrada }) {
  if (!r.horaInicio) return <IconeRelogio tamanho={18} />;
  const h = Number(r.horaInicio.slice(0, 2));
  return h >= 17 || h < 5 ? <IconeLua tamanho={18} /> : <IconeSol tamanho={18} />;
}

export function Tarifas() {
  const { temPermissao } = useAuth();
  const podeEditar = temPermissao('tarifa.gerenciar');
  const podePublicar = temPermissao('tarifa.publicar');
  const carregar = useCallback(() => tarifasApi.painel(), []);
  const painel = useCarregar(carregar);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [categoriaId, setCategoriaId] = useState<string | null>(null);
  const [edicoes, setEdicoes] = useState<Record<string, Campos>>({});
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro' | 'info'; texto: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [edicaoRegra, setEdicaoRegra] = useState<EdicaoRegra | null>(null);
  const [excluindo, setExcluindo] = useState<RegraCadastrada | null>(null);
  const [publicando, setPublicando] = useState<TabelaTarifaDetalhe | null>(null);
  const [descartando, setDescartando] = useState(false);

  useEffect(() => {
    vagasApi
      .categorias()
      .then((r) => setCategorias(r.itens.filter((c) => c.ativo)))
      .catch(() => undefined);
  }, []);

  const p = painel.dados;
  const vigente = p?.vigente ?? null;
  const rascunho = p?.rascunho ?? null;
  const base = rascunho ?? vigente;
  const catAtual = categorias.find((c) => c.id === categoriaId) ?? categorias[0] ?? null;

  const historico = useHistorico(p?.historico.map((t) => `${t.id}:${t.situacao}`).join(',') ?? '');

  const executar = async (acao: () => Promise<void>) => {
    setOcupado(true);
    setMensagem(null);
    try {
      await acao();
    } catch (e) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(e) });
    } finally {
      setOcupado(false);
    }
  };

  /** Toda alteração acontece numa versão em edição (criada a partir da que está em vigor). */
  async function garantirRascunho(): Promise<TabelaTarifaDetalhe> {
    if (rascunho) return rascunho;
    const t = await tarifasApi.novaVersao({});
    painel.recarregar();
    return t;
  }
  const correspondente = (t: TabelaTarifaDetalhe, r: RegraCadastrada) =>
    t.regras.find((x) => chave(x) === chave(r));

  const camposDaCategoria = (c: Categoria) => edicoes[c.id] ?? camposDe(padraoDe(base, c.id));
  const alterada = (c: Categoria) =>
    !!edicoes[c.id] && JSON.stringify(edicoes[c.id]) !== JSON.stringify(camposDe(padraoDe(base, c.id)));
  const categoriasAlteradas = categorias.filter(alterada);
  const temPendencias = categoriasAlteradas.length > 0 || !!rascunho;

  function alterarCampo(c: Categoria, nome: keyof Campos, valor: string) {
    setEdicoes((e) => ({ ...e, [c.id]: { ...camposDaCategoria(c), [nome]: valor } }));
  }

  /** "Salvar alterações": grava os preços na versão em edição e pede a confirmação para publicar. */
  const salvar = () =>
    executar(async () => {
      for (const c of categoriasAlteradas) {
        const f = edicoes[c.id]!;
        const primeira = lerCentavos(f.primeira);
        const adicional = lerCentavos(f.adicional);
        const diaria = f.diaria.trim() ? lerCentavos(f.diaria) : null;
        const teto = f.teto.trim() ? lerCentavos(f.teto) : null;
        if (
          primeira === null ||
          adicional === null ||
          (f.diaria.trim() && diaria === null) ||
          (f.teto.trim() && teto === null)
        )
          throw new Error(`${c.nome}: preencha os valores no formato 10,00.`);
      }
      let t = await garantirRascunho();
      for (const c of categoriasAlteradas) {
        const f = edicoes[c.id]!;
        const atual = padraoDe(t, c.id);
        const dados: DadosRegra = {
          ...(atual ?? {
            categoriaId: c.id,
            tipo: 'PADRAO',
            nome: null,
            aplicacao: null,
            diasSemana: null,
            horaInicio: null,
            horaFim: null,
            ativo: true,
            toleranciaMin: 10,
            fracaoMin: null,
            fracaoCentavos: null,
            carenciaMin: 0,
            valorFixoCentavos: null,
          }),
          primeiraHoraCentavos: lerCentavos(f.primeira)!,
          horaAdicionalCentavos: lerCentavos(f.adicional)!,
          diariaCentavos: f.diaria.trim() ? lerCentavos(f.diaria) : null,
          diariaMaximaCentavos: f.teto.trim() ? lerCentavos(f.teto) : null,
        };
        t = await tarifasApi.salvarRegra(t.id, atual?.id ?? null, dados);
      }
      setEdicoes({});
      painel.recarregar();
      if (podePublicar) setPublicando(t);
      else
        setMensagem({
          tipo: 'info',
          texto:
            'Alterações guardadas. Elas passam a valer quando um responsável com permissão de publicar salvar.',
        });
    });

  const abrirPeriodo = (r: RegraCadastrada | null, c: Categoria) =>
    executar(async () => {
      const t = await garantirRascunho();
      setEdicaoRegra({
        tabelaId: t.id,
        regra: r ? (correspondente(t, r) ?? null) : null,
        nova: r ? null : { categoriaId: c.id, tipo: 'ESPECIAL' },
        modelo: padraoDe(t, c.id),
        criouRascunho: !rascunho,
      });
    });

  const excluirPeriodo = (r: RegraCadastrada) =>
    executar(async () => {
      const t = await garantirRascunho();
      const alvo = correspondente(t, r);
      if (alvo) await tarifasApi.removerRegra(t.id, alvo.id);
      setExcluindo(null);
      painel.recarregar();
      setMensagem({
        tipo: 'info',
        texto: `Período "${r.nome}" removido. Clique em Salvar alterações para valer.`,
      });
    });

  const resumo = catAtual ? padraoDe(base, catAtual.id) : undefined;
  const periodos = catAtual ? periodosDe(base, catAtual.id) : [];

  return (
    <div className="pagina-tarifas">
      <header className="cabecalho cabecalho--icone">
        <div className="cabecalho__titulo">
          <span className="selo-pagina" aria-hidden="true">
            <IconeEtiqueta />
          </span>
          <div>
            <h1>Tarifas</h1>
            <p className="mudo">Configure as tarifas do estacionamento</p>
          </div>
        </div>
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
      {rascunho && (
        <div className="alerta alerta--info aviso-rascunho" role="status">
          <span>
            Há alterações ainda <strong>não publicadas</strong> (versão {rascunho.versao}). Os clientes
            continuam pagando a tabela em vigor até você clicar em <strong>Salvar alterações</strong>.
          </span>
          {podeEditar && (
            <button type="button" className="botao-texto" onClick={() => setDescartando(true)}>
              Descartar alterações
            </button>
          )}
        </div>
      )}
      {(p?.agendadas ?? []).map((t) => (
        <p key={t.id} className="alerta alerta--info">
          Nova tabela (versão {t.versao}) agendada para <strong>{formatarDataHora(t.vigenteDesde)}</strong>.
          {podePublicar && (
            <>
              {' '}
              <button
                type="button"
                className="botao-texto"
                onClick={() =>
                  void executar(async () => {
                    await tarifasApi.arquivar(t.id);
                    painel.recarregar();
                    setMensagem({ tipo: 'ok', texto: 'Agendamento cancelado.' });
                  })
                }
              >
                Cancelar agendamento
              </button>
            </>
          )}
        </p>
      ))}

      <div className="abas-categoria" role="tablist" aria-label="Categoria de veículo">
        {categorias.map((c) => {
          const Icone = c.codigo === 'MOTO' ? IconeMoto : IconeCarro;
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={catAtual?.id === c.id}
              className={`aba-categoria${catAtual?.id === c.id ? ' aba-categoria--ativa' : ''}`}
              onClick={() => setCategoriaId(c.id)}
            >
              <Icone tamanho={22} /> {c.nome}
              {alterada(c) && <span className="ponto-alterado" title="Alterado e não salvo" />}
            </button>
          );
        })}
      </div>

      {!p && !painel.erro && <p className="mudo">Carregando…</p>}
      {p && categorias.length === 0 && (
        <p className="cartao mudo">
          Cadastre as categorias de veículo em Vagas → Categorias para definir as tarifas.
        </p>
      )}

      {p && catAtual && (
        <div className="tarifas-corpo">
          <div className="tarifas-coluna">
            <section className="cartao">
              <h2 className="titulo-secao">
                {catAtual.codigo === 'MOTO' ? <IconeMoto tamanho={26} /> : <IconeCarro tamanho={26} />}{' '}
                Tarifas para {catAtual.nome}
              </h2>
              <div className="campos-tarifa">
                <CampoValor
                  rotulo="Valor da primeira hora"
                  valor={camposDaCategoria(catAtual).primeira}
                  onChange={(v) => alterarCampo(catAtual, 'primeira', v)}
                  desabilitado={!podeEditar || ocupado}
                />
                <CampoValor
                  rotulo="Valor da hora adicional"
                  valor={camposDaCategoria(catAtual).adicional}
                  onChange={(v) => alterarCampo(catAtual, 'adicional', v)}
                  desabilitado={!podeEditar || ocupado}
                />
                <CampoValor
                  rotulo="Valor da diária"
                  dica="Em branco = não oferece diária"
                  valor={camposDaCategoria(catAtual).diaria}
                  onChange={(v) => alterarCampo(catAtual, 'diaria', v)}
                  desabilitado={!podeEditar || ocupado}
                />
                <CampoValor
                  rotulo="Máximo cobrado por dia"
                  dica="Em branco = sem limite"
                  valor={camposDaCategoria(catAtual).teto}
                  onChange={(v) => alterarCampo(catAtual, 'teto', v)}
                  desabilitado={!podeEditar || ocupado}
                />
              </div>
              {resumo && podeEditar && (
                <button
                  type="button"
                  className="botao-texto"
                  onClick={() =>
                    void executar(async () => {
                      const t = await garantirRascunho();
                      setEdicaoRegra({
                        tabelaId: t.id,
                        regra: correspondente(t, resumo) ?? null,
                        nova: null,
                        criouRascunho: !rascunho,
                      });
                    })
                  }
                >
                  Mais opções (tolerância, fração, carência)
                </button>
              )}
            </section>

            <section className="cartao">
              <div className="cartao__topo">
                <h2 className="titulo-secao">
                  <IconeRelogio tamanho={24} /> Tarifas por período
                </h2>
                {podeEditar && (
                  <button
                    type="button"
                    className="botao botao--contorno"
                    onClick={() => void abrirPeriodo(null, catAtual)}
                    disabled={ocupado || !resumo}
                    title={!resumo ? 'Defina e salve primeiro a tarifa padrão' : undefined}
                  >
                    <IconeMais tamanho={18} /> Adicionar período
                  </button>
                )}
              </div>
              {periodos.length === 0 ? (
                <p className="mudo">
                  Nenhum período cadastrado. Use para preços diferentes em certos horários ou dias (ex.:
                  noturno, fim de semana) ou para convênios escolhidos na entrada.
                </p>
              ) : (
                <div className="tabela-rolagem">
                  <table className="tabela tabela--tarifas">
                    <thead>
                      <tr>
                        <th>Período</th>
                        <th>Horário</th>
                        <th>Valor</th>
                        {podeEditar && <th className="acoes-coluna">Ações</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {periodos.map((r) => (
                        <tr key={r.id} className={r.ativo ? undefined : 'linha-apagada'}>
                          <td>
                            <span className="periodo-nome">
                              <IconePeriodo r={r} /> {r.nome}
                              {!r.ativo && <span className="mudo pequeno"> (desativado)</span>}
                            </span>
                          </td>
                          <td>{horarioDoPeriodo(r)}</td>
                          <td className="sem-quebra">{valorDoPeriodo(r)}</td>
                          {podeEditar && (
                            <td className="acoes-coluna">
                              <button
                                type="button"
                                className="botao-icone botao-icone--azul"
                                aria-label={`Editar ${r.nome}`}
                                onClick={() => void abrirPeriodo(r, catAtual)}
                                disabled={ocupado}
                              >
                                <IconeLapis tamanho={16} />
                              </button>
                              <button
                                type="button"
                                className="botao-icone botao-icone--vermelho"
                                aria-label={`Excluir ${r.nome}`}
                                onClick={() => setExcluindo(r)}
                                disabled={ocupado}
                              >
                                <IconeLixeira tamanho={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>

          <div className="tarifas-coluna">
            <section className="cartao resumo-tarifas">
              <h2 className="titulo-secao">
                <IconeCalculadora tamanho={24} /> Resumo das tarifas
              </h2>
              <div className="resumo-tarifas__categoria">
                {catAtual.codigo === 'MOTO' ? <IconeMoto tamanho={24} /> : <IconeCarro tamanho={24} />}{' '}
                {catAtual.nome}
              </div>
              {resumo ? (
                <>
                  <div className="resumo-tarifas__valores">
                    {resumo.valorFixoCentavos === null && (
                      <>
                        <div>
                          <strong>{formatarCentavos(resumo.primeiraHoraCentavos)}</strong>
                          <span>1ª hora</span>
                        </div>
                        <div>
                          <strong>{formatarCentavos(resumo.horaAdicionalCentavos)}</strong>
                          <span>Hora adicional</span>
                        </div>
                      </>
                    )}
                    <div>
                      <strong>
                        {resumo.diariaCentavos === null ? '—' : formatarCentavos(resumo.diariaCentavos)}
                      </strong>
                      <span>Diária</span>
                    </div>
                  </div>
                  {periodos
                    .filter((r) => r.ativo)
                    .map((r) => (
                      <div key={r.id} className="resumo-tarifas__periodo">
                        <IconePeriodo r={r} />
                        <strong>{valorDoPeriodo(r)}</strong>
                        <span>
                          {r.nome} ({horarioDoPeriodo(r)})
                        </span>
                      </div>
                    ))}
                  <details className="resumo-tarifas__regras">
                    <summary>Todas as regras da tarifa padrão</summary>
                    <dl className="resumo resumo--linhas">
                      {linhasDaRegra(resumo).map(([k, v]) => (
                        <div key={k}>
                          <dt>{k}</dt>
                          <dd>{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                </>
              ) : (
                <p className="mudo">Sem tarifa definida para {catAtual.nome}. Preencha os valores e salve.</p>
              )}
              {vigente && (
                <p className="mudo pequeno">
                  Em vigor: versão {vigente.versao}
                  {vigente.vigenteDesde && ` desde ${formatarDataHora(vigente.vigenteDesde)}`}
                  {vigente.publicadoPor && ` · por ${vigente.publicadoPor}`}
                </p>
              )}
            </section>
            {podeEditar && (
              <button
                type="button"
                className="botao botao--grande"
                onClick={() =>
                  categoriasAlteradas.length || !rascunho || !podePublicar
                    ? void salvar()
                    : setPublicando(rascunho)
                }
                disabled={ocupado || !temPendencias}
              >
                <IconeSalvar tamanho={20} /> {ocupado ? 'Salvando…' : 'Salvar alterações'}
              </button>
            )}
          </div>
        </div>
      )}

      {p && (
        <section className="cartao">
          <h2 className="titulo-secao">
            <IconeHistorico tamanho={24} /> Histórico de alterações
          </h2>
          {historico === null ? (
            <p className="mudo">Carregando…</p>
          ) : historico.length === 0 ? (
            <p className="mudo">Nenhuma alteração publicada ainda.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>Usuário</th>
                    <th>Tipo de veículo</th>
                    <th>Alteração</th>
                    <th>Valor anterior</th>
                    <th>Novo valor</th>
                  </tr>
                </thead>
                <tbody>
                  {historico.slice(0, 40).map((h, i) => (
                    <tr key={i}>
                      <td className="sem-quebra">{formatarDataHora(h.em)}</td>
                      <td>{h.por ?? '—'}</td>
                      <td>
                        {h.categoria}
                        {h.tarifa !== 'Padrão' && <span className="mudo"> · {h.tarifa}</span>}
                      </td>
                      <td>{h.campo}</td>
                      <td className="mudo">{h.antes}</td>
                      <td>
                        <strong>{h.depois}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <details className="detalhes-extra">
            <summary>Versões da tabela de preços</summary>
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Versão</th>
                    <th>Situação</th>
                    <th>Valendo desde</th>
                    <th>Publicada por</th>
                    <th>Tickets cobrados</th>
                    {podeEditar && <th />}
                  </tr>
                </thead>
                <tbody>
                  {p.historico.map((t) => (
                    <tr key={t.id}>
                      <td>
                        v{t.versao} · {t.nome}
                      </td>
                      <td>
                        <span className={`etiqueta ${CLASSE_SITUACAO[t.situacao]}`}>
                          {ROTULO_SITUACAO[t.situacao]}
                        </span>
                      </td>
                      <td className="sem-quebra">{formatarDataHora(t.vigenteDesde)}</td>
                      <td>{t.publicadoPor ?? '—'}</td>
                      <td>{t.ticketsUsaram}</td>
                      {podeEditar && (
                        <td>
                          {!rascunho && t.situacao !== 'VIGENTE' && (
                            <button
                              type="button"
                              className="botao-texto"
                              disabled={ocupado}
                              onClick={() =>
                                void executar(async () => {
                                  await tarifasApi.novaVersao({ baseId: t.id });
                                  painel.recarregar();
                                  setMensagem({
                                    tipo: 'info',
                                    texto: `Preços da versão ${t.versao} copiados. Confira e clique em Salvar alterações para voltarem a valer.`,
                                  });
                                })
                              }
                            >
                              Usar como base
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details className="detalhes-extra">
            <summary>Simular preço</summary>
            <Simulador vigente={vigente} rascunho={rascunho} />
          </details>
        </section>
      )}

      {edicaoRegra && (
        <DialogoRegra
          tabelaId={edicaoRegra.tabelaId}
          regra={edicaoRegra.regra}
          nova={edicaoRegra.nova}
          modelo={edicaoRegra.modelo}
          categorias={categorias}
          onFechar={() => {
            const e = edicaoRegra;
            setEdicaoRegra(null);
            if (e.criouRascunho)
              void tarifasApi
                .descartar(e.tabelaId)
                .catch(() => undefined)
                .finally(() => painel.recarregar());
          }}
          onSalvo={() => {
            setEdicaoRegra(null);
            painel.recarregar();
            setMensagem({
              tipo: 'info',
              texto: 'Alteração guardada. Clique em Salvar alterações para valer.',
            });
          }}
        />
      )}
      {excluindo && (
        <Dialogo
          aberto
          perigo
          titulo={`Excluir o período "${excluindo.nome}"?`}
          textoConfirmar="Excluir"
          enviando={ocupado}
          onFechar={() => setExcluindo(null)}
          onConfirmar={() => void excluirPeriodo(excluindo)}
        >
          <p className="mudo">
            O período sai da próxima versão da tabela. Quem já entrou com ele continua pagando o preço da
            entrada.
          </p>
        </Dialogo>
      )}
      {publicando && (
        <DialogoPublicar
          rascunho={publicando}
          vigente={vigente}
          onFechar={() => {
            setPublicando(null);
            painel.recarregar();
          }}
          onPublicado={(texto) => {
            setPublicando(null);
            setMensagem({ tipo: 'ok', texto });
            painel.recarregar();
          }}
        />
      )}
      {descartando && rascunho && (
        <Dialogo
          aberto
          perigo
          titulo="Descartar as alterações não publicadas?"
          textoConfirmar="Descartar"
          enviando={ocupado}
          onFechar={() => setDescartando(false)}
          onConfirmar={() =>
            void executar(async () => {
              await tarifasApi.descartar(rascunho.id);
              setDescartando(false);
              setEdicoes({});
              painel.recarregar();
              setMensagem({
                tipo: 'ok',
                texto: 'Alterações descartadas. Continua valendo a tabela em vigor.',
              });
            })
          }
        >
          <p className="mudo">Os preços voltam a ser os da tabela em vigor. Nada muda para os clientes.</p>
        </Dialogo>
      )}
    </div>
  );
}

function CampoValor({
  rotulo,
  dica,
  valor,
  onChange,
  desabilitado,
}: {
  rotulo: string;
  dica?: string;
  valor: string;
  onChange: (v: string) => void;
  desabilitado: boolean;
}) {
  return (
    <label className="campo campo-valor">
      <span>{rotulo}</span>
      <span className="campo-valor__caixa">
        <span className="campo-valor__prefixo">R$</span>
        <input
          inputMode="decimal"
          value={valor}
          placeholder={dica ? '—' : '0,00'}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ''))}
          disabled={desabilitado}
        />
      </span>
      {dica && <small className="mudo">{dica}</small>}
    </label>
  );
}

/** Confirmação antes de as alterações valerem: mostra exatamente o que muda. */
function DialogoPublicar({
  rascunho,
  vigente,
  onFechar,
  onPublicado,
}: {
  rascunho: TabelaTarifaDetalhe;
  vigente: TabelaTarifaDetalhe | null;
  onFechar: () => void;
  onPublicado: (texto: string) => void;
}) {
  const [quando, setQuando] = useState<'agora' | 'agendar'>('agora');
  const [data, setData] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const lista = alteracoes(vigente, rascunho);

  async function publicar() {
    const inicio = quando === 'agendar' ? new Date(data) : null;
    if (inicio && (Number.isNaN(inicio.getTime()) || inicio.getTime() <= Date.now()))
      return setErro('Escolha uma data e hora no futuro.');
    setEnviando(true);
    setErro(null);
    try {
      await tarifasApi.publicar(rascunho.id, inicio ? inicio.toISOString() : null);
      onPublicado(
        inicio
          ? `Novos preços agendados para ${formatarDataHora(inicio.toISOString())}.`
          : 'Alterações salvas: os novos preços já valem para as próximas entradas.',
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
      largo
      titulo="Salvar as alterações de tarifa?"
      textoConfirmar={quando === 'agora' ? 'Salvar e aplicar agora' : 'Agendar'}
      enviando={enviando}
      erro={erro}
      onFechar={onFechar}
      onConfirmar={() => void publicar()}
    >
      {lista.length === 0 ? (
        <p className="mudo">Nenhuma diferença em relação à tabela em vigor.</p>
      ) : (
        <ul className="lista-alteracoes">
          {lista.map((a, i) => (
            <li key={i}>
              <strong>
                {a.categoria}
                {a.tarifa !== 'Padrão' && ` · ${a.tarifa}`}
              </strong>{' '}
              — {a.campo}: <span className="mudo">{a.antes}</span> → <strong>{a.depois}</strong>
            </li>
          ))}
        </ul>
      )}
      <p className="mudo pequeno">Quem já está estacionado continua pagando a tarifa da hora da entrada.</p>
      <fieldset className="opcoes-status">
        <legend>Quando vale</legend>
        <label className={`opcao-status${quando === 'agora' ? ' opcao-status--marcada' : ''}`}>
          <input type="radio" checked={quando === 'agora'} onChange={() => setQuando('agora')} /> Agora, para
          as próximas entradas
        </label>
        <label className={`opcao-status${quando === 'agendar' ? ' opcao-status--marcada' : ''}`}>
          <input type="radio" checked={quando === 'agendar'} onChange={() => setQuando('agendar')} /> A partir
          de:
          <input
            type="datetime-local"
            value={data}
            onChange={(e) => {
              setData(e.target.value);
              setQuando('agendar');
            }}
          />
        </label>
      </fieldset>
    </Dialogo>
  );
}

/** Alterações campo a campo entre versões publicadas consecutivas (dados reais do banco). */
function useHistorico(assinatura: string): LinhaHistorico[] | null {
  const [linhas, setLinhas] = useState<LinhaHistorico[] | null>(null);
  useEffect(() => {
    let ativo = true;
    const ids = assinatura
      .split(',')
      .filter(Boolean)
      .map((x) => x.split(':'))
      .filter(([, situacao]) => situacao !== 'ARQUIVADA')
      .map(([id]) => id!);
    Promise.all(ids.slice(0, 10).map((id) => tarifasApi.obter(id)))
      .then((versoes) => {
        const ordem = versoes.filter((v) => v.publicadoEm).sort((a, b) => a.versao - b.versao);
        const saida: LinhaHistorico[] = [];
        for (let i = 1; i < ordem.length; i++) {
          const v = ordem[i]!;
          for (const a of alteracoes(ordem[i - 1]!, v))
            saida.push({ ...a, em: v.publicadoEm!, por: v.publicadoPor, versao: v.versao });
        }
        if (ativo) setLinhas(saida.reverse());
      })
      .catch(() => ativo && setLinhas([]));
    return () => {
      ativo = false;
    };
  }, [assinatura]);
  return linhas;
}
