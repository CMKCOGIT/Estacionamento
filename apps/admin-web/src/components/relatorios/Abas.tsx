import { useCallback, useState } from 'react';
import {
  formatarCentavos,
  type Agrupamento,
  type CaixaResumo,
  type FormaPagamento,
  type PontoFaturamento,
  type RelatorioFaturamento,
  type TipoMovimentacao,
} from '@estacionamento/shared';
import { useCarregar } from '../../hooks/useCarregar';
import { useAtualizacaoAutomatica } from '../../hooks/useAtualizacaoAutomatica';
import { financeiroApi } from '../../services/financeiro';
import { relatoriosApi } from '../../services/relatorios';
import { formatarDataHora } from '../../services/rotulos';
import { DialogoCaixa } from '../financeiro/DialogoCaixa';
import { ROTULO_MOVIMENTACAO } from '../financeiro/rotulos';
import { TabelaMovimentacoes, TabelaPagamentos } from '../financeiro/Tabelas';
import { GraficoBarras } from '../graficos/GraficoBarras';
import { GraficoColunas } from '../graficos/GraficoColunas';
import { duracaoCurta } from '../vagas/MapaVagas';
import { imprimirPdf } from '../exportar';
import { baixarCsv, reaisCsv } from './csv';
import { DialogoDetalhe } from './DialogoDetalhe';
import { dataBr, diaMes, diaSemana, intervaloBr, mesAno, periodoDoAtalho, type Atalho } from './periodo';
import { SeletorPeriodo } from './SeletorPeriodo';

function Indicador({ rotulo, valor, extra }: { rotulo: string; valor: string; extra?: React.ReactNode }) {
  return (
    <div className="cartao indicador-cartao">
      <div className="indicador-cartao__rotulo">{rotulo}</div>
      <div className="indicador-cartao__valor">{valor}</div>
      {extra && <div className="indicador-cartao__extra">{extra}</div>}
    </div>
  );
}

function Variacao({ pct, de, ate }: { pct: number | null; de: string; ate: string }) {
  if (pct === null) return <span className="mudo">sem movimento em {intervaloBr(de, ate)}</span>;
  const sinal = pct > 0 ? '▲' : pct < 0 ? '▼' : '=';
  return (
    <span>
      {sinal} {Math.abs(pct).toLocaleString('pt-BR')}% em relação a {intervaloBr(de, ate)}
    </span>
  );
}

const rotuloGrupo = (p: PontoFaturamento, agrupar: Agrupamento) =>
  agrupar === 'DIA'
    ? `${diaSemana(p.inicio)} ${dataBr(p.inicio)}`
    : agrupar === 'SEMANA'
      ? `Semana de ${diaMes(p.inicio)} a ${diaMes(p.fim)}`
      : `${mesAno(p.inicio)}${p.inicio.slice(8) !== '01' || p.fim !== fimDoMes(p.fim) ? ` (${diaMes(p.inicio)} a ${diaMes(p.fim)})` : ''}`;
const fimDoMes = (d: string) => {
  const [a, m] = d.split('-').map(Number);
  return new Date(Date.UTC(a!, m!, 0)).toISOString().slice(0, 10);
};
const eixoGrupo = (p: PontoFaturamento, agrupar: Agrupamento): [string, string?] =>
  agrupar === 'DIA'
    ? [diaSemana(p.inicio), diaMes(p.inicio)]
    : agrupar === 'SEMANA'
      ? [diaMes(p.inicio)]
      : [mesAno(p.inicio)];

const NOME_AGRUPAMENTO: Record<Agrupamento, string> = { DIA: 'Diário', SEMANA: 'Semanal', MES: 'Mensal' };
const PADRAO: Record<Agrupamento, Atalho> = { DIA: '30d', SEMANA: '12semanas', MES: '12meses' };

// ---------------------------------------------------------------------------
// Faturamento (diário, semanal, mensal, personalizado)
// ---------------------------------------------------------------------------
export function AbaFaturamento() {
  const [agrupar, setAgrupar] = useState<Agrupamento>('DIA');
  const [periodo, setPeriodo] = useState(periodoDoAtalho('30d'));
  const carregar = useCallback(
    () => relatoriosApi.faturamento(periodo.de, periodo.ate, agrupar),
    [periodo, agrupar],
  );
  const { dados: r, erro, carregando } = useCarregar<RelatorioFaturamento>(carregar);
  const nome = (f: string) => r?.nomesFormas[f] ?? f;

  const exportar = () =>
    r &&
    baixarCsv(
      `faturamento-${NOME_AGRUPAMENTO[agrupar].toLowerCase()}-${r.de}-a-${r.ate}`,
      [
        'Período',
        'Início',
        'Fim',
        'Recebido',
        'Estornado',
        'Líquido',
        'Pagamentos',
        'Estornos',
        'Tickets encerrados',
        'Sem cobrança',
        'Troco',
      ],
      r.pontos.map((p) => [
        rotuloGrupo(p, agrupar),
        p.inicio,
        p.fim,
        reaisCsv(p.recebidoCentavos),
        reaisCsv(p.estornadoCentavos),
        reaisCsv(p.liquidoCentavos),
        p.quantidadePagamentos,
        p.quantidadeEstornos,
        p.ticketsEncerrados,
        p.ticketsSemCobranca,
        reaisCsv(p.trocoCentavos),
      ]),
    );

  return (
    <>
      <div className="abas-internas" role="group" aria-label="Agrupar por">
        {(['DIA', 'SEMANA', 'MES'] as Agrupamento[]).map((a) => (
          <button
            key={a}
            type="button"
            className={`chip${agrupar === a ? ' chip--ativo' : ''}`}
            aria-pressed={agrupar === a}
            onClick={() => {
              setAgrupar(a);
              setPeriodo(periodoDoAtalho(PADRAO[a]));
            }}
          >
            {NOME_AGRUPAMENTO[a]}
          </button>
        ))}
      </div>
      <SeletorPeriodo
        de={periodo.de}
        ate={periodo.ate}
        atalhos={
          agrupar === 'DIA'
            ? ['hoje', '7d', '30d', 'mes', 'mesPassado']
            : agrupar === 'SEMANA'
              ? ['12semanas', 'mes', 'ano']
              : ['12meses', 'ano']
        }
        onMudar={setPeriodo}
      />
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {carregando && !r && <p className="mudo">Carregando…</p>}
      {r && (
        <>
          <div className="cartoes">
            <Indicador
              rotulo="Faturamento (líquido)"
              valor={formatarCentavos(r.totais.liquidoCentavos)}
              extra={<Variacao pct={r.variacaoLiquidoPct} de={r.anterior.de} ate={r.anterior.ate} />}
            />
            <Indicador
              rotulo="Recebido"
              valor={formatarCentavos(r.totais.recebidoCentavos)}
              extra={`${r.totais.quantidadePagamentos} pagamento(s)`}
            />
            <Indicador
              rotulo="Estornos"
              valor={formatarCentavos(r.totais.estornadoCentavos)}
              extra={`${r.totais.quantidadeEstornos} estorno(s)`}
            />
            <Indicador
              rotulo="Média por dia"
              valor={formatarCentavos(r.totais.mediaDiariaCentavos)}
              extra={`${r.totais.dias} dia(s)`}
            />
            <Indicador
              rotulo="Tickets encerrados"
              valor={String(r.totais.ticketsEncerrados)}
              extra={`médio ${r.totais.ticketMedioCentavos === null ? '—' : formatarCentavos(r.totais.ticketMedioCentavos)} · ${r.totais.ticketsSemCobranca} sem cobrança`}
            />
          </div>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>
                Faturamento {NOME_AGRUPAMENTO[agrupar].toLowerCase()} · {intervaloBr(r.de, r.ate)}
              </h2>
              <button type="button" className="botao botao--secundario botao--pequeno" onClick={exportar}>
                Excel
              </button>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno nao-imprimir"
                onClick={() => imprimirPdf(document.querySelector('h1')?.textContent ?? 'relatorio')}
              >
                PDF
              </button>
            </div>
            <GraficoColunas
              descricao={`Faturamento líquido ${NOME_AGRUPAMENTO[agrupar].toLowerCase()} de ${intervaloBr(r.de, r.ate)}`}
              pontos={r.pontos.map((p) => ({
                chave: p.inicio,
                eixo: eixoGrupo(p, agrupar),
                valorCentavos: p.liquidoCentavos,
                titulo: rotuloGrupo(p, agrupar),
                linhas: [
                  `${p.quantidadePagamentos} pagamento(s) · ${p.ticketsEncerrados} ticket(s)`,
                  ...(p.estornadoCentavos ? [`Estornos: − ${formatarCentavos(p.estornadoCentavos)}`] : []),
                  ...p.porForma.map((f) => `${nome(f.forma)}: ${formatarCentavos(f.liquidoCentavos)}`),
                ],
              }))}
            />
            <p className="pequeno mudo">
              Faturamento = pagamentos recebidos no período menos os estornos. Passe o mouse sobre uma coluna
              para ver o detalhe por forma de pagamento.
            </p>
          </section>
          <section className="cartao">
            <h2>Receita por tipo de veículo</h2>
            {r.porCategoria.length === 0 ? (
              <p className="mudo">Nenhum pagamento no período.</p>
            ) : (
              <GraficoBarras
                descricao="Faturamento líquido por tipo de veículo"
                barras={r.porCategoria.map((c) => {
                  const total = r.porCategoria.reduce((t, c) => t + c.liquidoCentavos, 0);
                  return {
                    chave: c.codigo,
                    rotulo: c.nome,
                    valor: c.liquidoCentavos,
                    texto: `${formatarCentavos(c.liquidoCentavos)}${total > 0 ? ` · ${Math.round((c.liquidoCentavos / total) * 100)}%` : ''}`,
                    linhas: [`${c.tickets} ticket(s) · ${c.pagamentos} pagamento(s)`],
                  };
                })}
              />
            )}
          </section>
          <section className="cartao">
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th scope="col">Período</th>
                    <th scope="col" className="numero">
                      Recebido
                    </th>
                    <th scope="col" className="numero">
                      Estornos
                    </th>
                    <th scope="col" className="numero">
                      Líquido
                    </th>
                    <th scope="col" className="numero">
                      Pagamentos
                    </th>
                    <th scope="col" className="numero">
                      Tickets
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...r.pontos].reverse().map((p) => (
                    <tr
                      key={p.inicio}
                      className={
                        p.quantidadePagamentos === 0 && p.ticketsEncerrados === 0 ? 'linha-vazia' : undefined
                      }
                    >
                      <td>{rotuloGrupo(p, agrupar)}</td>
                      <td className="numero">{formatarCentavos(p.recebidoCentavos)}</td>
                      <td className="numero">
                        {p.estornadoCentavos ? `− ${formatarCentavos(p.estornadoCentavos)}` : '—'}
                      </td>
                      <td className="numero">
                        <strong>{formatarCentavos(p.liquidoCentavos)}</strong>
                      </td>
                      <td className="numero">{p.quantidadePagamentos}</td>
                      <td className="numero">{p.ticketsEncerrados}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tabela__total">
                    <td>Total</td>
                    <td className="numero">{formatarCentavos(r.totais.recebidoCentavos)}</td>
                    <td className="numero">
                      {r.totais.estornadoCentavos ? `− ${formatarCentavos(r.totais.estornadoCentavos)}` : '—'}
                    </td>
                    <td className="numero">{formatarCentavos(r.totais.liquidoCentavos)}</td>
                    <td className="numero">{r.totais.quantidadePagamentos}</td>
                    <td className="numero">{r.totais.ticketsEncerrados}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Por forma de pagamento
// ---------------------------------------------------------------------------
export function AbaFormas() {
  const [periodo, setPeriodo] = useState(periodoDoAtalho('mes'));
  const carregar = useCallback(() => relatoriosApi.formas(periodo.de, periodo.ate), [periodo]);
  const { dados: r, erro } = useCarregar(carregar);
  const exportar = () =>
    r &&
    baixarCsv(
      `formas-de-pagamento-${r.de}-a-${r.ate}`,
      [
        'Forma',
        'Pagamentos',
        'Recebido',
        'Estornos',
        'Estornado',
        'Líquido',
        '% do líquido',
        'Média por pagamento',
        'Troco',
      ],
      r.formas.map((f) => [
        f.nome,
        f.quantidade,
        reaisCsv(f.recebidoCentavos),
        f.quantidadeEstornos,
        reaisCsv(f.estornadoCentavos),
        reaisCsv(f.liquidoCentavos),
        f.percentual.toString().replace('.', ','),
        reaisCsv(f.mediaPorPagamentoCentavos),
        reaisCsv(f.trocoCentavos),
      ]),
    );
  return (
    <>
      <SeletorPeriodo
        de={periodo.de}
        ate={periodo.ate}
        atalhos={['hoje', '7d', '30d', 'mes', 'mesPassado', 'ano']}
        onMudar={setPeriodo}
      />
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {r && (
        <>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>Faturamento por forma de pagamento · {intervaloBr(r.de, r.ate)}</h2>
              <button type="button" className="botao botao--secundario botao--pequeno" onClick={exportar}>
                Excel
              </button>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno nao-imprimir"
                onClick={() => imprimirPdf(document.querySelector('h1')?.textContent ?? 'relatorio')}
              >
                PDF
              </button>
            </div>
            {r.formas.length === 0 ? (
              <p className="mudo">Nenhum pagamento no período.</p>
            ) : (
              <GraficoBarras
                descricao={`Faturamento líquido por forma de pagamento de ${intervaloBr(r.de, r.ate)}`}
                barras={r.formas.map((f) => ({
                  chave: f.forma,
                  rotulo: f.nome,
                  valor: Math.max(0, f.liquidoCentavos),
                  texto: `${formatarCentavos(f.liquidoCentavos)} · ${f.percentual.toLocaleString('pt-BR')}%`,
                  linhas: [
                    `${f.quantidade} pagamento(s) · média ${f.mediaPorPagamentoCentavos === null ? '—' : formatarCentavos(f.mediaPorPagamentoCentavos)}`,
                    ...(f.estornadoCentavos ? [`Estornos: − ${formatarCentavos(f.estornadoCentavos)}`] : []),
                    ...(f.trocoCentavos ? [`Troco dado: ${formatarCentavos(f.trocoCentavos)}`] : []),
                  ],
                }))}
              />
            )}
          </section>
          <section className="cartao">
            <div className="tabela-rolagem">
              <table className="tabela tabela--compacta">
                <thead>
                  <tr>
                    <th scope="col">Forma</th>
                    <th scope="col" className="numero">
                      Pagamentos
                    </th>
                    <th scope="col" className="numero">
                      Recebido
                    </th>
                    <th scope="col" className="numero">
                      Estornado
                    </th>
                    <th scope="col" className="numero">
                      Líquido
                    </th>
                    <th scope="col" className="numero">
                      %
                    </th>
                    <th scope="col" className="numero">
                      Média
                    </th>
                    <th scope="col" className="numero">
                      Troco
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.formas.map((f) => (
                    <tr key={f.forma}>
                      <td>
                        {f.nome}
                        {f.parcelasMedia !== null && f.parcelasMedia > 1 && (
                          <span className="mudo pequeno">
                            {' '}
                            · {f.parcelasMedia.toLocaleString('pt-BR')}× em média
                          </span>
                        )}
                      </td>
                      <td className="numero">{f.quantidade}</td>
                      <td className="numero">{formatarCentavos(f.recebidoCentavos)}</td>
                      <td className="numero">
                        {f.estornadoCentavos ? `− ${formatarCentavos(f.estornadoCentavos)}` : '—'}
                      </td>
                      <td className="numero">
                        <strong>{formatarCentavos(f.liquidoCentavos)}</strong>
                      </td>
                      <td className="numero">{f.percentual.toLocaleString('pt-BR')}%</td>
                      <td className="numero">
                        {f.mediaPorPagamentoCentavos === null
                          ? '—'
                          : formatarCentavos(f.mediaPorPagamentoCentavos)}
                      </td>
                      <td className="numero">{f.trocoCentavos ? formatarCentavos(f.trocoCentavos) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="tabela__total">
                    <td>Total</td>
                    <td className="numero">{r.totais.quantidade}</td>
                    <td className="numero">{formatarCentavos(r.totais.recebidoCentavos)}</td>
                    <td className="numero">
                      {r.totais.estornadoCentavos ? `− ${formatarCentavos(r.totais.estornadoCentavos)}` : '—'}
                    </td>
                    <td className="numero">{formatarCentavos(r.totais.liquidoCentavos)}</td>
                    <td className="numero">100%</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Histórico de pagamentos e movimentações (com detalhe de cada uma)
// ---------------------------------------------------------------------------
export function AbaHistorico({ formas }: { formas: FormaPagamento[] }) {
  const [ver, setVer] = useState<'pagamentos' | 'movimentacoes'>('pagamentos');
  const [periodo, setPeriodo] = useState(periodoDoAtalho('7d'));
  const [forma, setForma] = useState('');
  const [status, setStatus] = useState('');
  const [tipo, setTipo] = useState<'' | TipoMovimentacao>('');
  const [busca, setBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [detalhe, setDetalhe] = useState<{ pagamentoId: string } | { movimentacaoId: string } | null>(null);
  const mudar = (f: () => void) => {
    setPagina(1);
    f();
  };
  const carregarPagamentos = useCallback(
    () =>
      ver === 'pagamentos'
        ? financeiroApi.pagamentos({ ...periodo, forma, status, busca: busca.trim(), pagina })
        : Promise.resolve(null),
    [ver, periodo, forma, status, busca, pagina],
  );
  const carregarMovs = useCallback(
    () =>
      ver === 'movimentacoes'
        ? financeiroApi.movimentacoes({ ...periodo, forma, tipo, pagina })
        : Promise.resolve(null),
    [ver, periodo, forma, tipo, pagina],
  );
  const pagamentos = useCarregar(carregarPagamentos);
  const movs = useCarregar(carregarMovs);
  const proxima = ver === 'pagamentos' ? pagamentos.dados?.proximaPagina : movs.dados?.proximaPagina;

  return (
    <>
      <div className="abas-internas" role="group" aria-label="Ver">
        <button
          type="button"
          className={`chip${ver === 'pagamentos' ? ' chip--ativo' : ''}`}
          aria-pressed={ver === 'pagamentos'}
          onClick={() => mudar(() => setVer('pagamentos'))}
        >
          Pagamentos
        </button>
        <button
          type="button"
          className={`chip${ver === 'movimentacoes' ? ' chip--ativo' : ''}`}
          aria-pressed={ver === 'movimentacoes'}
          onClick={() => mudar(() => setVer('movimentacoes'))}
        >
          Todas as movimentações do caixa
        </button>
      </div>
      <SeletorPeriodo
        de={periodo.de}
        ate={periodo.ate}
        atalhos={['hoje', 'ontem', '7d', '30d', 'mes']}
        onMudar={(p) => mudar(() => setPeriodo(p))}
      >
        <label className="campo">
          <span>Forma</span>
          <select value={forma} onChange={(e) => mudar(() => setForma(e.target.value))}>
            <option value="">Todas</option>
            {formas.map((f) => (
              <option key={f.codigo} value={f.codigo}>
                {f.nome}
              </option>
            ))}
          </select>
        </label>
        {ver === 'pagamentos' ? (
          <>
            <label className="campo">
              <span>Situação</span>
              <select value={status} onChange={(e) => mudar(() => setStatus(e.target.value))}>
                <option value="">Todos</option>
                <option value="CONFIRMADO">Concluídos</option>
                <option value="ESTORNADO">Estornados</option>
              </select>
            </label>
            <label className="campo">
              <span>Placa ou nº</span>
              <input
                value={busca}
                onChange={(e) => mudar(() => setBusca(e.target.value.toUpperCase()))}
                maxLength={20}
              />
            </label>
          </>
        ) : (
          <label className="campo">
            <span>Tipo</span>
            <select
              value={tipo}
              onChange={(e) => mudar(() => setTipo(e.target.value as TipoMovimentacao | ''))}
            >
              <option value="">Todos</option>
              {(Object.keys(ROTULO_MOVIMENTACAO) as TipoMovimentacao[]).map((t) => (
                <option key={t} value={t}>
                  {ROTULO_MOVIMENTACAO[t]}
                </option>
              ))}
            </select>
          </label>
        )}
      </SeletorPeriodo>
      {(pagamentos.erro || movs.erro) && (
        <p className="alerta alerta--erro">{(pagamentos.erro ?? movs.erro)!.message}</p>
      )}
      <section className="cartao">
        {ver === 'pagamentos' && pagamentos.dados && (
          <>
            <p className="resumo-linha">
              <strong>{pagamentos.dados.totais.quantidade}</strong> pagamento(s) · concluídos{' '}
              <strong>{formatarCentavos(pagamentos.dados.totais.confirmadosCentavos)}</strong>
              {pagamentos.dados.totais.estornadosCentavos > 0 && (
                <> · estornados {formatarCentavos(pagamentos.dados.totais.estornadosCentavos)}</>
              )}
            </p>
            <TabelaPagamentos
              itens={pagamentos.dados.itens}
              onDetalhe={(p) => setDetalhe({ pagamentoId: p.id })}
            />
          </>
        )}
        {ver === 'movimentacoes' && movs.dados && (
          <>
            <p className="resumo-linha">
              Entradas <strong>{formatarCentavos(movs.dados.totais.entradasCentavos)}</strong> · saídas{' '}
              <strong>{formatarCentavos(movs.dados.totais.saidasCentavos)}</strong> · saldo{' '}
              <strong>
                {formatarCentavos(movs.dados.totais.entradasCentavos - movs.dados.totais.saidasCentavos)}
              </strong>
            </p>
            <TabelaMovimentacoes
              itens={movs.dados.itens}
              onDetalhe={(m) => setDetalhe({ movimentacaoId: m.id })}
            />
          </>
        )}
        {(pagina > 1 || proxima) && (
          <div className="acoes">
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              disabled={pagina === 1}
              onClick={() => setPagina(pagina - 1)}
            >
              Anterior
            </button>
            <span className="pequeno mudo">Página {pagina}</span>
            <button
              type="button"
              className="botao botao--secundario botao--pequeno"
              disabled={!proxima}
              onClick={() => proxima && setPagina(proxima)}
            >
              Próxima
            </button>
          </div>
        )}
      </section>
      {detalhe && <DialogoDetalhe alvo={detalhe} onFechar={() => setDetalhe(null)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Pagamentos pendentes
// ---------------------------------------------------------------------------
export function AbaPendentes() {
  const carregar = useCallback(() => relatoriosApi.pendentes(), []);
  const { dados: r, erro, atualizadoEm } = useAtualizacaoAutomatica(carregar, 30_000);
  return (
    <>
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {r && (
        <>
          <div className="cartoes">
            <Indicador
              rotulo="A receber agora"
              valor={formatarCentavos(r.totalCentavos)}
              extra={`${r.quantidade} ticket(s) no estacionamento`}
            />
            <Indicador
              rotulo="Já pagaram uma parte"
              valor={String(r.itens.filter((p) => p.parcial).length)}
              extra={formatarCentavos(r.itens.reduce((t, p) => t + p.pagoCentavos, 0)) + ' já recebidos'}
            />
          </div>
          <section className="cartao">
            <h2>A receber por tempo de permanência</h2>
            <GraficoBarras
              descricao="Valor a receber por tempo de permanência"
              barras={r.faixas.map((f) => ({
                chave: f.rotulo,
                rotulo: f.rotulo,
                valor: f.totalCentavos,
                texto: `${formatarCentavos(f.totalCentavos)} · ${f.quantidade} ticket(s)`,
              }))}
            />
            <p className="pequeno mudo">
              Calculado agora pelo servidor
              {atualizadoEm ? ` (${atualizadoEm.toLocaleTimeString('pt-BR')})` : ''}: valor acumulado menos o
              já pago. Atualiza a cada 30 segundos.
            </p>
          </section>
          <section className="cartao">
            {r.itens.length === 0 ? (
              <p className="mudo">Nenhum valor pendente.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th scope="col">Ticket</th>
                      <th scope="col">Vaga</th>
                      <th scope="col">Entrada</th>
                      <th scope="col">Tempo</th>
                      <th scope="col" className="numero">
                        Acumulado
                      </th>
                      <th scope="col" className="numero">
                        Já pago
                      </th>
                      <th scope="col" className="numero">
                        A receber
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.itens.map((p) => (
                      <tr key={p.sessaoId}>
                        <td>
                          nº {p.numero} · <strong>{p.placa}</strong>
                          {p.parcial && <span className="etiqueta etiqueta--bloqueado">Parcial</span>}
                        </td>
                        <td>{p.vaga ?? '—'}</td>
                        <td className="sem-quebra">{formatarDataHora(p.entradaEm)}</td>
                        <td>{duracaoCurta(p.permanenciaMin)}</td>
                        <td className="numero">{formatarCentavos(p.valorAcumuladoCentavos)}</td>
                        <td className="numero">{p.pagoCentavos ? formatarCentavos(p.pagoCentavos) : '—'}</td>
                        <td className="numero">
                          <strong>{formatarCentavos(p.aPagarCentavos)}</strong>
                        </td>
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

// ---------------------------------------------------------------------------
// Fechamentos de caixa
// ---------------------------------------------------------------------------
function SituacaoFechamento({ c }: { c: CaixaResumo }) {
  const d = c.diferencaCentavos ?? 0;
  if (d === 0) return <span className="etiqueta etiqueta--ativo">✓ Conferiu</span>;
  return d > 0 ? (
    <span className="etiqueta etiqueta--bloqueado">▲ Sobra de {formatarCentavos(d)}</span>
  ) : (
    <span className="etiqueta etiqueta--erro">▼ Falta de {formatarCentavos(-d)}</span>
  );
}

export function AbaFechamentos() {
  const [periodo, setPeriodo] = useState(periodoDoAtalho('30d'));
  const [caixa, setCaixa] = useState<string | null>(null);
  const carregar = useCallback(() => relatoriosApi.fechamentos(periodo.de, periodo.ate), [periodo]);
  const { dados: r, erro } = useCarregar(carregar);
  const exportar = () =>
    r &&
    baixarCsv(
      `fechamentos-de-caixa-${r.de}-a-${r.ate}`,
      [
        'Fechado em',
        'Guichê',
        'Operador',
        'Aberto em',
        'Fechado por',
        'Recebido',
        'Esperado (dinheiro)',
        'Contado',
        'Diferença',
        'Observação',
      ],
      r.itens.map((c) => [
        c.fechadoEm ? formatarDataHora(c.fechadoEm) : '',
        c.posto,
        c.operador,
        formatarDataHora(c.abertoEm),
        c.fechadoPor,
        reaisCsv(c.recebidoCentavos),
        reaisCsv(c.dinheiroEsperadoCentavos),
        reaisCsv(c.saldoContadoCentavos),
        reaisCsv(c.diferencaCentavos),
        c.observacao,
      ]),
    );
  return (
    <>
      <SeletorPeriodo
        de={periodo.de}
        ate={periodo.ate}
        atalhos={['hoje', '7d', '30d', 'mes', 'mesPassado']}
        onMudar={setPeriodo}
      />
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {r && (
        <>
          <div className="cartoes">
            <Indicador
              rotulo="Fechamentos"
              valor={String(r.totais.quantidade)}
              extra={`${r.totais.conferidos} conferiram`}
            />
            <Indicador
              rotulo="Com falta"
              valor={String(r.totais.comFalta)}
              extra={`total ${formatarCentavos(r.totais.faltaCentavos)}`}
            />
            <Indicador
              rotulo="Com sobra"
              valor={String(r.totais.comSobra)}
              extra={`total ${formatarCentavos(r.totais.sobraCentavos)}`}
            />
            <Indicador
              rotulo="Diferença líquida"
              valor={formatarCentavos(r.totais.diferencaLiquidaCentavos)}
              extra={`recebido nesses caixas ${formatarCentavos(r.totais.recebidoCentavos)}`}
            />
          </div>
          <section className="cartao">
            <div className="cartao__topo">
              <h2>Fechamentos de caixa · {intervaloBr(r.de, r.ate)}</h2>
              <button type="button" className="botao botao--secundario botao--pequeno" onClick={exportar}>
                Excel
              </button>
              <button
                type="button"
                className="botao botao--secundario botao--pequeno nao-imprimir"
                onClick={() => imprimirPdf(document.querySelector('h1')?.textContent ?? 'relatorio')}
              >
                PDF
              </button>
            </div>
            {r.itens.length === 0 ? (
              <p className="mudo">Nenhum caixa fechado no período.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela tabela--compacta">
                  <thead>
                    <tr>
                      <th scope="col">Fechado em</th>
                      <th scope="col">Caixa</th>
                      <th scope="col">Duração</th>
                      <th scope="col" className="numero">
                        Recebido
                      </th>
                      <th scope="col" className="numero">
                        Esperado
                      </th>
                      <th scope="col" className="numero">
                        Contado
                      </th>
                      <th scope="col">Conferência</th>
                      <th scope="col">
                        <span className="sr-only">Detalhes</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.itens.map((c) => (
                      <tr key={c.id}>
                        <td className="sem-quebra">{c.fechadoEm ? formatarDataHora(c.fechadoEm) : '—'}</td>
                        <td>
                          {c.posto} · {c.operador}
                          {c.fechadoPor && c.fechadoPor !== c.operador && (
                            <div className="pequeno mudo">fechado por {c.fechadoPor}</div>
                          )}
                        </td>
                        <td>
                          {c.fechadoEm
                            ? duracaoCurta(
                                Math.round((Date.parse(c.fechadoEm) - Date.parse(c.abertoEm)) / 60_000),
                              )
                            : '—'}
                        </td>
                        <td className="numero">{formatarCentavos(c.recebidoCentavos)}</td>
                        <td className="numero">{formatarCentavos(c.dinheiroEsperadoCentavos)}</td>
                        <td className="numero">
                          {c.saldoContadoCentavos === null ? '—' : formatarCentavos(c.saldoContadoCentavos)}
                        </td>
                        <td>
                          <SituacaoFechamento c={c} />
                          {c.observacao && <div className="pequeno mudo">{c.observacao}</div>}
                        </td>
                        <td>
                          <button type="button" className="botao-texto" onClick={() => setCaixa(c.id)}>
                            Detalhes
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
      {caixa && (
        <DialogoCaixa
          caixaId={caixa}
          podeFechar={false}
          onFechar={() => setCaixa(null)}
          onMudou={() => undefined}
        />
      )}
    </>
  );
}
