import { useState } from 'react';
import { useLargura } from './util';

export interface Barra {
  chave: string;
  rotulo: string;
  valor: number;
  /** Texto do valor no fim da barra (ex.: "R$ 20,00 · 40%"). */
  texto: string;
  /** Linhas extras do tooltip. */
  linhas?: string[];
}

interface Props {
  barras: Barra[];
  descricao: string;
}

const ALTURA_BARRA = 18;
const ESPACO = 14;
const ROTULO = 128;
const TEXTO = 150;

/**
 * Barras horizontais de uma série (comparar categorias). Nome à esquerda,
 * valor escrito no fim de cada barra (poucas barras), base reta no zero e
 * ponta arredondada; tooltip com o detalhe.
 */
export function GraficoBarras({ barras, descricao }: Props) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const rotulo = Math.min(ROTULO, largura * 0.32);
  const texto = Math.min(TEXTO, largura * 0.34);
  const w = Math.max(largura - rotulo - texto - 8, 10);
  const max = Math.max(...barras.map((b) => b.valor), 1);
  const altura = barras.length * (ALTURA_BARRA + ESPACO) + 4;
  const b = ativo !== null ? barras[ativo] : undefined;

  const barra = (i: number, valor: number) => {
    const x0 = rotulo;
    const comp = Math.max(0, (valor / max) * w);
    if (comp < 0.5) return '';
    const y0 = 2 + i * (ALTURA_BARRA + ESPACO);
    const r = Math.min(4, comp / 2, ALTURA_BARRA / 2);
    const x1 = x0 + comp;
    return `M${x0},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${y0 + ALTURA_BARRA - r}Q${x1},${y0 + ALTURA_BARRA} ${x1 - r},${y0 + ALTURA_BARRA}H${x0}Z`;
  };

  return (
    <div ref={ref} className="grafico__area">
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={descricao}>
          <line className="grafico__base" x1={rotulo} x2={rotulo} y1={0} y2={altura} />
          {barras.map((br, i) => {
            const yMeio = 2 + i * (ALTURA_BARRA + ESPACO) + ALTURA_BARRA / 2;
            const fim = rotulo + Math.max(0, (br.valor / max) * w);
            return (
              <g key={br.chave}>
                <text
                  className="grafico__eixo grafico__eixo--categoria"
                  x={rotulo - 8}
                  y={yMeio}
                  dy="0.32em"
                  textAnchor="end"
                >
                  {br.rotulo}
                </text>
                <path
                  className={`grafico__coluna${ativo === i ? ' grafico__coluna--ativa' : ''}`}
                  d={barra(i, br.valor)}
                />
                <text className="grafico__rotulo" x={fim + 6} y={yMeio} dy="0.32em">
                  {br.texto}
                </text>
                <rect
                  x={0}
                  y={yMeio - (ALTURA_BARRA + ESPACO) / 2}
                  width={largura}
                  height={ALTURA_BARRA + ESPACO}
                  fill="transparent"
                  tabIndex={br.linhas?.length ? 0 : -1}
                  role={br.linhas?.length ? 'button' : undefined}
                  aria-label={`${br.rotulo}: ${br.texto}`}
                  onPointerEnter={() => setAtivo(i)}
                  onPointerLeave={() => setAtivo(null)}
                  onFocus={() => setAtivo(i)}
                  onBlur={() => setAtivo(null)}
                />
              </g>
            );
          })}
        </svg>
      )}
      {b && ativo !== null && b.linhas?.length ? (
        <div
          className="grafico__dica"
          style={{
            left: Math.min(rotulo + 20, Math.max(largura - 210, 0)),
            top: 2 + ativo * (ALTURA_BARRA + ESPACO) + ALTURA_BARRA + 4,
          }}
          role="status"
        >
          <strong>{b.rotulo}</strong>
          {b.linhas.map((l) => (
            <span key={l} className="grafico__dica-linha">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
