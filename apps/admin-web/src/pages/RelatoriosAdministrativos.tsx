import { useEffect, useState } from 'react';
import {
  formatarCentavos,
  formatarPlaca,
  type AtividadeRegistrada,
  type HistoricoPlaca,
  type IndicadoresOperacionais,
  type LinhaMovimento,
  type MovimentoFuncionario,
  type OpcaoFuncionario,
  type RelatorioBloqueios,
  type RelatorioMovimento,
  type RelatorioOcupacao,
  type VeiculoEstacionado,
} from '@estacionamento/shared';
import { GraficoBarras } from '../components/graficos/GraficoBarras';
import { GraficoColunas } from '../components/graficos/GraficoColunas';
import { baixarCsv, reaisCsv } from '../components/relatorios/csv';
import {
  diaMes,
  diaSemana,
  intervaloBr,
  periodoDoAtalho,
  type Atalho,
} from '../components/relatorios/periodo';
import { SeletorPeriodo } from '../components/relatorios/SeletorPeriodo';
import { duracaoCurta } from '../components/vagas/MapaVagas';
import { useAuth } from '../auth/contexto';
import { relatoriosAdmApi, type FiltrosAdm } from '../services/relatoriosOperacionais';
import { ROTULOS_ACOES } from '../services/rotulos';
import { usuariosApi } from '../services/usuarios';

type Aba =
  | 'indicadores'
  | 'movimento'
  | 'estacionados'
  | 'placa'
  | 'ocupacao'
  | 'bloqueios'
  | 'funcionarios'
  | 'atividades';
const ABAS: [Aba, string][] = [
  ['indicadores', 'Indicadores'],
  ['movimento', 'Entradas e saídas'],
  ['estacionados', 'Veículos estacionados'],
  ['placa', 'Histórico por placa'],
  ['ocupacao', 'Ocupação'],
  ['bloqueios', 'Vagas bloqueadas'],
  ['funcionarios', 'Por funcionário'],
  ['atividades', 'Histórico de atividades'],
];
const ATALHOS: Atalho[] = ['hoje', 'ontem', '7d', '30d', 'mes', 'mesPassado'];
const SITUACAO: Record<string, string> = { ABERTA: 'No pátio', ENCERRADA: 'Saiu', CANCELADA: 'Cancelado' };
const dh = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
const erroDe = (e: unknown) => (e instanceof Error ? e.message : 'Não foi possível carregar.');

/** Carrega um relatório quando os filtros mudam (sem setState síncrono no efeito). */
function useRelatorio<T>(carregar: () => Promise<T>, deps: unknown[]) {
  const [estado, setEstado] = useState<{ dados: T | null; erro: string | null; carregando: boolean }>({
    dados: null,
    erro: null,
    carregando: true,
  });
  useEffect(() => {
    let vivo = true;
    void Promise.resolve()
      .then(() => setEstado((e) => ({ ...e, carregando: true })))
      .then(carregar)
      .then(
        (dados) => vivo && setEstado({ dados, erro: null, carregando: false }),
        (e: unknown) => vivo && setEstado({ dados: null, erro: erroDe(e), carregando: false }),
      );
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return estado;
}

function Cartao({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: string }) {
  return (
    <div className="cartao indicador-cartao">
      <div className="indicador-cartao__rotulo">{rotulo}</div>
      <div className="indicador-cartao__valor">{valor}</div>
      {extra && <div className="indicador-cartao__extra">{extra}</div>}
    </div>
  );
}

function Estado({ erro, carregando, vazio }: { erro: string | null; carregando: boolean; vazio?: boolean }) {
  if (erro)
    return (
      <p className="alerta alerta--erro" role="alert">
        {erro}
      </p>
    );
  if (carregando) return <p className="mudo">Carregando…</p>;
  if (vazio) return <p className="mudo">Nada encontrado com estes filtros.</p>;
  return null;
}

/** Relatórios administrativos da operação (permissão relatorio.operacional). */
export function RelatoriosAdministrativos() {
  const [aba, setAba] = useState<Aba>('indicadores');
  const [f, setF] = useState<FiltrosAdm>(() => ({ ...periodoDoAtalho('7d') }));
  const [funcionarios, setFuncionarios] = useState<OpcaoFuncionario[]>([]);
  useEffect(() => {
    relatoriosAdmApi.funcionarios().then(
      (r) => setFuncionarios(r.itens),
      () => undefined,
    );
  }, []);
  const usaPlaca = aba === 'movimento' || aba === 'estacionados';
  const usaFuncionario = ['movimento', 'estacionados', 'bloqueios', 'funcionarios', 'atividades'].includes(
    aba,
  );
  const usaSituacao = aba === 'movimento';
  const usaPeriodo = !['estacionados', 'placa'].includes(aba);

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Relatórios administrativos</h1>
          <p className="mudo">
            Operação do estacionamento com os dados reais do banco: movimento, pátio, ocupação e equipe.
          </p>
        </div>
      </header>
      <div className="abas abas--pagina" role="tablist">
        {ABAS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? 'aba aba--ativa' : 'aba'}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {usaPeriodo ? (
        <SeletorPeriodo de={f.de} ate={f.ate} atalhos={ATALHOS} onMudar={(p) => setF({ ...f, ...p })}>
          <FiltrosExtras
            f={f}
            setF={setF}
            funcionarios={funcionarios}
            placa={usaPlaca}
            funcionario={usaFuncionario}
            situacao={usaSituacao}
          />
        </SeletorPeriodo>
      ) : (
        aba === 'estacionados' && (
          <div className="filtros cartao seletor-periodo">
            <FiltrosExtras f={f} setF={setF} funcionarios={funcionarios} placa funcionario situacao={false} />
          </div>
        )
      )}
      {aba === 'indicadores' && <AbaIndicadores f={f} />}
      {aba === 'movimento' && <AbaMovimento f={f} />}
      {aba === 'estacionados' && <AbaEstacionados f={f} />}
      {aba === 'placa' && <AbaPlaca />}
      {aba === 'ocupacao' && <AbaOcupacao f={f} />}
      {aba === 'bloqueios' && <AbaBloqueios f={f} />}
      {aba === 'funcionarios' && <AbaFuncionarios f={f} />}
      {aba === 'atividades' && <AbaAtividades f={f} />}
    </>
  );
}

function FiltrosExtras({
  f,
  setF,
  funcionarios,
  placa,
  funcionario,
  situacao,
}: {
  f: FiltrosAdm;
  setF: (f: FiltrosAdm) => void;
  funcionarios: OpcaoFuncionario[];
  placa: boolean;
  funcionario: boolean;
  situacao: boolean;
}) {
  return (
    <>
      {placa && (
        <label className="campo">
          <span>Placa</span>
          <input
            value={f.placa ?? ''}
            maxLength={10}
            placeholder="início da placa"
            onChange={(e) => setF({ ...f, placa: e.target.value.toUpperCase() || undefined })}
          />
        </label>
      )}
      {funcionario && (
        <label className="campo">
          <span>Funcionário</span>
          <select
            value={f.operadorId ?? ''}
            onChange={(e) => setF({ ...f, operadorId: e.target.value || undefined })}
          >
            <option value="">Todos</option>
            {funcionarios.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nome}
              </option>
            ))}
          </select>
        </label>
      )}
      {situacao && (
        <label className="campo">
          <span>Situação</span>
          <select
            value={f.situacao ?? ''}
            onChange={(e) => setF({ ...f, situacao: e.target.value || undefined })}
          >
            <option value="">Todas</option>
            <option value="ABERTA">No pátio</option>
            <option value="ENCERRADA">Saiu</option>
            <option value="CANCELADA">Cancelado</option>
          </select>
        </label>
      )}
    </>
  );
}

function TabelaMovimento({ itens }: { itens: LinhaMovimento[] }) {
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela--compacta">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Placa</th>
            <th>Categoria</th>
            <th>Vaga</th>
            <th>Entrada</th>
            <th>Saída</th>
            <th>Situação</th>
            <th className="numero">Permanência</th>
            <th className="numero">Valor</th>
            <th>Entrada por</th>
            <th>Saída por</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((i) => (
            <tr key={i.id}>
              <td>{i.numero}</td>
              <td>{formatarPlaca(i.placa)}</td>
              <td>{i.categoria}</td>
              <td>{i.vaga ?? '—'}</td>
              <td>{dh(i.entradaEm)}</td>
              <td>{dh(i.saidaEm ?? i.canceladoEm)}</td>
              <td>{SITUACAO[i.situacao]}</td>
              <td className="numero">{duracaoCurta(i.permanenciaMin)}</td>
              <td className="numero">
                {i.valorFinalCentavos === null ? '—' : formatarCentavos(i.valorFinalCentavos)}
              </td>
              <td>{i.operadorEntrada}</td>
              <td>{i.operadorSaida ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const csvMovimento = (nome: string, itens: LinhaMovimento[]) =>
  baixarCsv(
    nome,
    [
      'Ticket',
      'Placa',
      'Categoria',
      'Vaga',
      'Entrada',
      'Saída',
      'Situação',
      'Permanência (min)',
      'Valor',
      'Entrada por',
      'Saída por',
    ],
    itens.map((i) => [
      i.numero,
      formatarPlaca(i.placa),
      i.categoria,
      i.vaga,
      dh(i.entradaEm),
      dh(i.saidaEm ?? i.canceladoEm),
      SITUACAO[i.situacao] ?? i.situacao,
      i.permanenciaMin,
      reaisCsv(i.valorFinalCentavos),
      i.operadorEntrada,
      i.operadorSaida,
    ]),
  );

function AbaIndicadores({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<IndicadoresOperacionais>(() => relatoriosAdmApi.indicadores(f), [f.de, f.ate]);
  const d = r.dados;
  return (
    <>
      <Estado erro={r.erro} carregando={r.carregando && !d} />
      {d && (
        <>
          <div className="indicadores">
            <Cartao rotulo="Entradas" valor={String(d.entradas)} extra={`${d.entradasPorDia} por dia`} />
            <Cartao
              rotulo="Saídas"
              valor={String(d.saidas)}
              extra={`rotatividade ${d.rotatividade} por vaga/dia`}
            />
            <Cartao
              rotulo="No pátio agora"
              valor={String(d.veiculosAgora)}
              extra={`${d.vagasBloqueadasAgora} vaga(s) bloqueada(s)`}
            />
            <Cartao
              rotulo="Permanência"
              valor={duracaoCurta(d.permanenciaMediaMin)}
              extra={`mediana ${duracaoCurta(d.permanenciaMedianaMin)} · ${d.dentroDaToleranciaPct}% na tolerância`}
            />
            <Cartao
              rotulo="Ocupação"
              valor={`${d.ocupacaoMediaPct}%`}
              extra={`pico ${d.ocupacaoPicoPct}%${d.horaDePico !== null ? ` · mais cheio às ${d.horaDePico}h` : ''}`}
            />
            <Cartao
              rotulo="Ticket médio"
              valor={formatarCentavos(d.ticketMedioCentavos)}
              extra={`${formatarCentavos(d.receitaPorVagaDiaCentavos)} por vaga/dia`}
            />
            <Cartao
              rotulo="Cancelamentos"
              valor={String(d.cancelamentos)}
              extra={`${d.taxaCancelamento}% das entradas`}
            />
          </div>
          {d.porCategoria.length > 0 && (
            <section className="cartao">
              <h2>Entradas por categoria · {intervaloBr(f.de, f.ate)}</h2>
              <GraficoBarras
                descricao="Entradas por categoria"
                barras={d.porCategoria.map((c) => ({
                  chave: c.categoria,
                  rotulo: c.categoria,
                  valor: c.entradas,
                  texto: `${c.entradas} · ${duracaoCurta(c.permanenciaMediaMin)} em média`,
                }))}
              />
            </section>
          )}
          <p className="pequeno mudo">
            Rotatividade = saídas por vaga por dia. Ocupação = média de vagas ocupadas sobre as vagas ativas.
            Ticket médio só dos tickets cobrados.
          </p>
        </>
      )}
    </>
  );
}

function AbaMovimento({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<RelatorioMovimento>(
    () => relatoriosAdmApi.movimento(f),
    [f.de, f.ate, f.placa, f.operadorId, f.situacao],
  );
  const d = r.dados;
  return (
    <>
      <Estado erro={r.erro} carregando={r.carregando && !d} />
      {d && (
        <>
          <div className="indicadores">
            <Cartao rotulo="Entradas" valor={String(d.totais.entradas)} />
            <Cartao rotulo="Saídas" valor={String(d.totais.saidas)} />
            <Cartao rotulo="Cancelados" valor={String(d.totais.cancelados)} />
            <Cartao rotulo="Ainda no pátio" valor={String(d.totais.abertos)} />
          </div>
          <section className="cartao">
            <h2>Entradas por dia · {intervaloBr(f.de, f.ate)}</h2>
            <GraficoColunas
              formato="numero"
              descricao="Entradas por dia"
              pontos={d.porDia.map((p) => ({
                chave: p.dia,
                eixo: [diaSemana(p.dia), diaMes(p.dia)],
                valorCentavos: p.entradas,
                titulo: `${diaSemana(p.dia)} ${diaMes(p.dia)}`,
                linhas: [`${p.entradas} entrada(s) · ${p.saidas} saída(s)`],
              }))}
            />
          </section>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>{d.itens.length} ticket(s)</h2>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno"
                onClick={() => csvMovimento(`entradas-saidas-${f.de}-a-${f.ate}`, d.itens)}
                disabled={!d.itens.length}
              >
                Exportar planilha
              </button>
            </div>
            {d.truncado && (
              <p className="alerta alerta--info">Mostrando os 2.000 mais recentes. Use um período menor.</p>
            )}
            <Estado erro={null} carregando={false} vazio={!d.itens.length} />
            {d.itens.length > 0 && <TabelaMovimento itens={d.itens} />}
          </section>
        </>
      )}
    </>
  );
}

function AbaEstacionados({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<{ itens: VeiculoEstacionado[] }>(
    () => relatoriosAdmApi.estacionados({ placa: f.placa, operadorId: f.operadorId }),
    [f.placa, f.operadorId],
  );
  const itens = r.dados?.itens ?? [];
  const total = itens.reduce((t, v) => t + v.valorAcumuladoCentavos, 0);
  return (
    <section className="cartao">
      <div className="cartao__topo">
        <h2>
          {itens.length} veículo(s) no pátio · {formatarCentavos(total)} acumulados
        </h2>
      </div>
      <Estado erro={r.erro} carregando={r.carregando && !r.dados} vazio={r.dados !== null && !itens.length} />
      {itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Placa</th>
                <th>Categoria</th>
                <th>Vaga</th>
                <th>Entrada</th>
                <th className="numero">Tempo</th>
                <th className="numero">Valor até agora</th>
                <th className="numero">Já pago</th>
                <th>Entrada por</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((v) => (
                <tr key={v.id}>
                  <td>{v.numero}</td>
                  <td>{formatarPlaca(v.placa)}</td>
                  <td>{v.categoria}</td>
                  <td>{v.vaga ?? '—'}</td>
                  <td>{dh(v.entradaEm)}</td>
                  <td className="numero">{duracaoCurta(v.permanenciaMin)}</td>
                  <td className="numero">{formatarCentavos(v.valorAcumuladoCentavos)}</td>
                  <td className="numero">{v.pagoCentavos ? formatarCentavos(v.pagoCentavos) : '—'}</td>
                  <td>{v.operadorEntrada}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function AbaPlaca() {
  const [placa, setPlaca] = useState('');
  const [r, setR] = useState<{ dados: HistoricoPlaca | null; erro: string | null }>({
    dados: null,
    erro: null,
  });
  const buscar = (e: React.FormEvent) => {
    e.preventDefault();
    relatoriosAdmApi.placa(placa).then(
      (dados) => setR({ dados, erro: null }),
      (x: unknown) => setR({ dados: null, erro: erroDe(x) }),
    );
  };
  const d = r.dados;
  return (
    <>
      <form className="filtros cartao seletor-periodo" onSubmit={buscar}>
        <label className="campo">
          <span>Placa</span>
          <input value={placa} maxLength={10} onChange={(e) => setPlaca(e.target.value.toUpperCase())} />
        </label>
        <button type="submit" className="botao" disabled={placa.length < 4}>
          Buscar
        </button>
      </form>
      <Estado erro={r.erro} carregando={false} />
      {d && (
        <>
          <div className="indicadores">
            <Cartao
              rotulo={formatarPlaca(d.placa)}
              valor={`${d.resumo.visitas} visita(s)`}
              extra={
                d.veiculo
                  ? [d.veiculo.categoria, d.veiculo.marca, d.veiculo.modelo, d.veiculo.cor]
                      .filter(Boolean)
                      .join(' · ')
                  : 'sem cadastro'
              }
            />
            <Cartao rotulo="Total pago" valor={formatarCentavos(d.resumo.totalPagoCentavos)} />
            <Cartao rotulo="Permanência média" valor={duracaoCurta(d.resumo.permanenciaMediaMin)} />
            <Cartao rotulo="Última visita" valor={dh(d.resumo.ultimaVisitaEm)} />
          </div>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>Estadias</h2>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno"
                onClick={() => csvMovimento(`historico-${d.placa}`, d.estadias)}
                disabled={!d.estadias.length}
              >
                Exportar planilha
              </button>
            </div>
            <Estado erro={null} carregando={false} vazio={!d.estadias.length} />
            {d.estadias.length > 0 && <TabelaMovimento itens={d.estadias} />}
          </section>
        </>
      )}
    </>
  );
}

function AbaOcupacao({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<RelatorioOcupacao>(() => relatoriosAdmApi.ocupacao(f), [f.de, f.ate]);
  const d = r.dados;
  return (
    <>
      <Estado erro={r.erro} carregando={r.carregando && !d} />
      {d && (
        <>
          <section className="cartao">
            <h2>Pico de vagas ocupadas por dia · capacidade {d.capacidade}</h2>
            <GraficoColunas
              formato="numero"
              descricao="Pico de ocupação por dia"
              pontos={d.porDia.map((p) => ({
                chave: p.dia,
                eixo: [diaSemana(p.dia), diaMes(p.dia)],
                valorCentavos: p.picoOcupadas,
                titulo: `${diaSemana(p.dia)} ${diaMes(p.dia)}`,
                linhas: [
                  `Pico: ${p.picoOcupadas} vaga(s)${p.picoEm ? ` às ${new Date(p.picoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}`,
                  `Média: ${p.mediaOcupadas.toLocaleString('pt-BR')} (${p.taxaMedia.toLocaleString('pt-BR')}%)`,
                ],
              }))}
            />
          </section>
          <section className="cartao">
            <h2>Média de vagas ocupadas por hora do dia</h2>
            <GraficoColunas
              formato="numero"
              descricao="Perfil horário de ocupação"
              pontos={d.perfilHorario.map((h) => ({
                chave: String(h.hora),
                eixo: [`${h.hora}h`],
                valorCentavos: Math.round(h.mediaOcupadas),
                titulo: `${h.hora}h às ${h.hora + 1}h`,
                linhas: [`Média: ${h.mediaOcupadas.toLocaleString('pt-BR')} vaga(s) ocupada(s)`],
              }))}
            />
            <p className="pequeno mudo">Ajuda a escalar a equipe nos horários de maior movimento.</p>
          </section>
          <section className="cartao">
            <h2>Por categoria</h2>
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className="numero">Vagas ativas</th>
                    <th className="numero">Média ocupada</th>
                    <th className="numero">Pico</th>
                  </tr>
                </thead>
                <tbody>
                  {d.porCategoria.map((c) => (
                    <tr key={c.categoria}>
                      <td>{c.categoria}</td>
                      <td className="numero">{c.capacidade}</td>
                      <td className="numero">{c.mediaOcupadas.toLocaleString('pt-BR')}</td>
                      <td className="numero">{c.picoOcupadas}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function AbaBloqueios({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<RelatorioBloqueios>(
    () => relatoriosAdmApi.bloqueios(f),
    [f.de, f.ate, f.operadorId],
  );
  const d = r.dados;
  return (
    <>
      <Estado erro={r.erro} carregando={r.carregando && !d} />
      {d && (
        <>
          <section className="cartao">
            <h2>Bloqueadas agora ({d.atuais.length})</h2>
            <Estado erro={null} carregando={false} vazio={!d.atuais.length} />
            {d.atuais.length > 0 && (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th>Vaga</th>
                      <th>Categoria</th>
                      <th>Motivo</th>
                      <th>Desde</th>
                      <th className="numero">Dias</th>
                      <th>Bloqueada por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.atuais.map((v) => (
                      <tr key={v.id}>
                        <td>{v.codigo}</td>
                        <td>{v.categoria}</td>
                        <td>{v.motivo ?? '—'}</td>
                        <td>{dh(v.desde)}</td>
                        <td className={`numero${v.diasBloqueada >= 7 ? ' texto-falha' : ''}`}>
                          {v.diasBloqueada}
                        </td>
                        <td>{v.bloqueadaPor ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <section className="cartao">
            <h2>Bloqueios e liberações · {intervaloBr(f.de, f.ate)}</h2>
            <Estado erro={null} carregando={false} vazio={!d.historico.length} />
            {d.historico.length > 0 && (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th>Quando</th>
                      <th>Vaga</th>
                      <th>O que</th>
                      <th>Motivo</th>
                      <th>Por</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.historico.map((h, i) => (
                      <tr key={i}>
                        <td>{dh(h.em)}</td>
                        <td>{h.vaga}</td>
                        <td>{h.acao === 'BLOQUEADA' ? 'Bloqueada' : 'Liberada'}</td>
                        <td>{h.motivo ?? '—'}</td>
                        <td>{h.usuario ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}

function AbaFuncionarios({ f }: { f: FiltrosAdm }) {
  const r = useRelatorio<{ itens: MovimentoFuncionario[] }>(
    () => relatoriosAdmApi.porFuncionario(f),
    [f.de, f.ate, f.operadorId],
  );
  const itens = r.dados?.itens ?? [];
  return (
    <>
      <Estado erro={r.erro} carregando={r.carregando && !r.dados} vazio={r.dados !== null && !itens.length} />
      {itens.length > 0 && (
        <>
          <section className="cartao">
            <h2>Entradas e saídas registradas · {intervaloBr(f.de, f.ate)}</h2>
            <GraficoBarras
              descricao="Entradas e saídas por funcionário"
              barras={itens.map((x) => ({
                chave: x.usuarioId,
                rotulo: x.nome,
                valor: x.entradas + x.saidas,
                texto: `${x.entradas} entradas · ${x.saidas} saídas`,
              }))}
            />
          </section>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>Detalhe por funcionário</h2>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno"
                onClick={() =>
                  baixarCsv(
                    `funcionarios-${f.de}-a-${f.ate}`,
                    [
                      'Funcionário',
                      'Entradas',
                      'Saídas',
                      'Cancelamentos',
                      'Pagamentos',
                      'Recebido',
                      'Estornos',
                      'Descontos',
                      'Caixas',
                    ],
                    itens.map((x) => [
                      x.nome,
                      x.entradas,
                      x.saidas,
                      x.cancelamentos,
                      x.pagamentos,
                      reaisCsv(x.recebidoCentavos),
                      x.estornos,
                      reaisCsv(x.descontosCentavos),
                      x.caixasAbertos,
                    ]),
                  )
                }
              >
                Exportar planilha
              </button>
            </div>
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th>Funcionário</th>
                    <th className="numero">Entradas</th>
                    <th className="numero">Saídas</th>
                    <th className="numero">Cancelamentos</th>
                    <th className="numero">Pagamentos</th>
                    <th className="numero">Recebido</th>
                    <th className="numero">Estornos</th>
                    <th className="numero">Descontos</th>
                    <th className="numero">Caixas</th>
                  </tr>
                </thead>
                <tbody>
                  {itens.map((x) => (
                    <tr key={x.usuarioId}>
                      <td>{x.nome}</td>
                      <td className="numero">{x.entradas}</td>
                      <td className="numero">{x.saidas}</td>
                      <td className={`numero${x.cancelamentos ? ' texto-falha' : ''}`}>{x.cancelamentos}</td>
                      <td className="numero">{x.pagamentos}</td>
                      <td className="numero">{formatarCentavos(x.recebidoCentavos)}</td>
                      <td className="numero">{x.estornos}</td>
                      <td className="numero">
                        {x.descontosCentavos ? formatarCentavos(x.descontosCentavos) : '—'}
                      </td>
                      <td className="numero">{x.caixasAbertos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function AbaAtividades({ f }: { f: FiltrosAdm }) {
  const { temPermissao } = useAuth();
  const pode = temPermissao('auditoria.ver');
  const r = useRelatorio<{ itens: AtividadeRegistrada[] }>(
    () =>
      pode
        ? usuariosApi.atividades({ de: f.de, ate: f.ate, usuarioId: f.operadorId, limite: '200' })
        : Promise.resolve({ itens: [] }),
    [f.de, f.ate, f.operadorId, pode],
  );
  if (!pode)
    return <p className="alerta alerta--info">O histórico de atividades exige a permissão de auditoria.</p>;
  const itens = r.dados?.itens ?? [];
  return (
    <section className="cartao">
      <h2>Atividades · {intervaloBr(f.de, f.ate)} (200 mais recentes)</h2>
      <Estado erro={r.erro} carregando={r.carregando && !r.dados} vazio={r.dados !== null && !itens.length} />
      {itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O que</th>
                <th>Motivo</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a) => (
                <tr key={a.id}>
                  <td>{dh(a.criadoEm)}</td>
                  <td>{a.usuario?.nome ?? 'Sistema'}</td>
                  <td>{ROTULOS_ACOES[a.acao] ?? a.acao}</td>
                  <td>{a.motivo ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="pequeno mudo">
        Detalhes completos (antes/depois de cada alteração) em Atividades, no menu.
      </p>
    </section>
  );
}
