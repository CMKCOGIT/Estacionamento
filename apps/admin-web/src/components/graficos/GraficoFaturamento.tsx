import { useState } from 'react';
import { formatarCentavos, type FaturamentoDia } from '@estacionamento/shared';
import { reaisEixo, ticksBonitos, useLargura } from './util';

interface Props {
  dias: FaturamentoDia[];
  /** Código → nome da forma de pagamento (para o detalhamento). */
  nomesFormas: Record<string, string>;
}

const ALTURA = 220;
const M = { topo: 22, dir: 8, base: 30, esq: 56 };
const LARGURA_MAX_COLUNA = 24;

const diaSemana = (data: string) =>
  new Date(`${data}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .replace('.', '');
const diaMes = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;

/** Faturamento diário (uma série). Detalhe por forma de pagamento no tooltip e na tabela. */
export function GraficoFaturamento({ dias, nomesFormas }: Props) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);

  // Sem movimento, o eixo vai até R$ 100; passo mínimo de R$ 1,00 (100 centavos)
  const maxValor = Math.max(...dias.map((d) => d.totalCentavos), 10_000);
  const ticks = ticksBonitos(maxValor, 4, 100);
  const topo = ticks.at(-1) ?? maxValor;
  const w = Math.max(largura - M.esq - M.dir, 10);
  const h = ALTURA - M.topo - M.base;
  const banda = w / Math.max(dias.length, 1);
  const larguraColuna = Math.min(LARGURA_MAX_COLUNA, banda * 0.6);
  const xCentro = (i: number) => M.esq + banda * i + banda / 2;
  const y = (v: number) => M.topo + h - (v / topo) * h;
  const hoje = dias.length - 1;
  const maior = dias.reduce((m, d, i) => (d.totalCentavos > (dias[m]?.totalCentavos ?? 0) ? i : m), 0);

  /** Coluna com 4px arredondados só no topo (base reta, apoiada no eixo). */
  const coluna = (i: number, valor: number) => {
    const x0 = xCentro(i) - larguraColuna / 2;
    const y0 = y(valor);
    const base = y(0);
    const r = Math.min(4, (base - y0) / 2, larguraColuna / 2);
    if (base - y0 < 0.5) return '';
    return `M${x0},${base}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + larguraColuna - r}Q${x0 + larguraColuna},${y0} ${x0 + larguraColuna},${y0 + r}V${base}Z`;
  };

  const detalhe = (d: FaturamentoDia) =>
    Object.entries(d.porForma)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
  const diaAtivo = ativo !== null ? dias[ativo] : undefined;

  return (
    <div className="grafico">
      <div className="grafico__topo">
        <button
          type="button"
          className="botao-texto"
          onClick={() => setTabela((t) => !t)}
          aria-pressed={tabela}
        >
          {tabela ? 'Ver gráfico' : 'Ver tabela'}
        </button>
      </div>
      {tabela ? (
        <div className="tabela-rolagem grafico__tabela">
          <table className="tabela">
            <thead>
              <tr>
                <th>Dia</th>
                {Object.values(nomesFormas).map((n) => (
                  <th key={n} className="numero">
                    {n}
                  </th>
                ))}
                <th className="numero">Total</th>
              </tr>
            </thead>
            <tbody>
              {dias.map((d) => (
                <tr key={d.data}>
                  <td>
                    {diaSemana(d.data)} {diaMes(d.data)}
                  </td>
                  {Object.keys(nomesFormas).map((f) => (
                    <td key={f} className="numero">
                      {formatarCentavos(d.porForma[f] ?? 0)}
                    </td>
                  ))}
                  <td className="numero">
                    <strong>{formatarCentavos(d.totalCentavos)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="grafico__area">
          {largura > 0 && (
            <svg width={largura} height={ALTURA} role="img" aria-label="Faturamento dos últimos 7 dias">
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    className={t === 0 ? 'grafico__base' : 'grafico__grade'}
                    x1={M.esq}
                    x2={M.esq + w}
                    y1={y(t)}
                    y2={y(t)}
                  />
                  <text className="grafico__eixo" x={M.esq - 6} y={y(t)} dy="0.32em" textAnchor="end">
                    {reaisEixo(t, topo)}
                  </text>
                </g>
              ))}
              {dias.map((d, i) => (
                <g key={d.data}>
                  <text className="grafico__eixo" x={xCentro(i)} y={ALTURA - 16} textAnchor="middle">
                    {i === hoje ? 'Hoje' : diaSemana(d.data)}
                  </text>
                  <text className="grafico__eixo" x={xCentro(i)} y={ALTURA - 4} textAnchor="middle">
                    {diaMes(d.data)}
                  </text>
                  <path
                    className={`grafico__coluna${ativo === i ? ' grafico__coluna--ativa' : ''}`}
                    d={coluna(i, d.totalCentavos)}
                  />
                  {(i === hoje || i === maior) && d.totalCentavos > 0 && (
                    <text
                      className="grafico__rotulo"
                      x={xCentro(i)}
                      y={y(d.totalCentavos) - 6}
                      textAnchor="middle"
                    >
                      {formatarCentavos(d.totalCentavos)}
                    </text>
                  )}
                  {/* Área de toque maior que a coluna (toda a faixa do dia) */}
                  <rect
                    x={M.esq + banda * i}
                    y={M.topo}
                    width={banda}
                    height={h}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${diaSemana(d.data)} ${diaMes(d.data)}: ${formatarCentavos(d.totalCentavos)}`}
                    onPointerEnter={() => setAtivo(i)}
                    onPointerLeave={() => setAtivo(null)}
                    onFocus={() => setAtivo(i)}
                    onBlur={() => setAtivo(null)}
                  />
                </g>
              ))}
            </svg>
          )}
          {diaAtivo && ativo !== null && (
            <div
              className="grafico__dica"
              style={{
                left: Math.min(Math.max(xCentro(ativo) - 90, 0), largura - 190),
                top: Math.max(y(diaAtivo.totalCentavos) - 90, 0),
              }}
              role="status"
            >
              <strong>{formatarCentavos(diaAtivo.totalCentavos)}</strong>
              <span>
                {ativo === hoje ? 'Hoje' : diaSemana(diaAtivo.data)} {diaMes(diaAtivo.data)}
              </span>
              {detalhe(diaAtivo).map(([forma, valor]) => (
                <span key={forma} className="grafico__dica-linha">
                  {nomesFormas[forma] ?? forma}: {formatarCentavos(valor)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
