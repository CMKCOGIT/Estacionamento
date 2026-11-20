import { useState } from 'react';
import { formatarCentavos } from '@estacionamento/shared';
import { reaisEixo, ticksBonitos, useLargura } from './util';

export interface PontoColuna {
  chave: string;
  /** Rótulo do eixo: uma ou duas linhas (ex.: ["seg", "02/11"]). */
  eixo: [string, string?];
  valorCentavos: number;
  /** Tooltip: título e linhas de detalhe. */
  titulo: string;
  linhas: string[];
}

interface Props {
  pontos: PontoColuna[];
  descricao: string;
  altura?: number;
}

const M = { topo: 22, dir: 8, base: 30, esq: 60 };
const LARGURA_MAX_COLUNA = 28;

/**
 * Colunas de uma série (dinheiro ao longo do tempo). Uma cor só (a do título),
 * grade discreta, rótulo direto só no maior valor, tooltip ao passar o mouse
 * ou focar pelo teclado. Aceita valores negativos (dia com mais estornos).
 */
export function GraficoColunas({ pontos, descricao, altura = 240 }: Props) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);

  const valores = pontos.map((p) => p.valorCentavos);
  const ticks = ticksBonitos(Math.max(...valores, 10_000), 4, 100);
  const topo = ticks.at(-1)!;
  const minimo = Math.min(0, ...valores);
  const fundo = minimo < 0 ? -ticksBonitos(-minimo, 1, 100).at(-1)! : 0;
  const w = Math.max(largura - M.esq - M.dir, 10);
  const h = altura - M.topo - M.base;
  const banda = w / Math.max(pontos.length, 1);
  const larguraColuna = Math.max(2, Math.min(LARGURA_MAX_COLUNA, banda * 0.65));
  const xCentro = (i: number) => M.esq + banda * i + banda / 2;
  const y = (v: number) => M.topo + ((topo - v) / (topo - fundo)) * h;
  const maior = valores.reduce((m, v, i) => (v > (valores[m] ?? 0) ? i : m), 0);
  // Rótulos do eixo sem sobreposição: um a cada `passo` colunas
  const passo = Math.max(1, Math.ceil(pontos.length / Math.max(1, Math.floor(w / 46))));
  const linhasGrade = fundo < 0 ? [fundo, ...ticks] : ticks;

  /** Coluna com 4px arredondados só na ponta do dado; a base fica reta no zero. */
  const coluna = (i: number, valor: number) => {
    const x0 = xCentro(i) - larguraColuna / 2;
    const base = y(0);
    const ponta = y(valor);
    const altura = Math.abs(base - ponta);
    if (altura < 0.5) return '';
    const r = Math.min(4, altura / 2, larguraColuna / 2);
    const x1 = x0 + larguraColuna;
    return valor >= 0
      ? `M${x0},${base}V${ponta + r}Q${x0},${ponta} ${x0 + r},${ponta}H${x1 - r}Q${x1},${ponta} ${x1},${ponta + r}V${base}Z`
      : `M${x0},${base}V${ponta - r}Q${x0},${ponta} ${x0 + r},${ponta}H${x1 - r}Q${x1},${ponta} ${x1},${ponta - r}V${base}Z`;
  };

  const p = ativo !== null ? pontos[ativo] : undefined;
  return (
    <div ref={ref} className="grafico__area">
      {largura > 0 && (
        <svg width={largura} height={altura} role="img" aria-label={descricao}>
          {linhasGrade.map((t) => (
            <g key={t}>
              <line
                className={t === 0 ? 'grafico__base' : 'grafico__grade'}
                x1={M.esq}
                x2={M.esq + w}
                y1={y(t)}
                y2={y(t)}
              />
              <text className="grafico__eixo" x={M.esq - 6} y={y(t)} dy="0.32em" textAnchor="end">
                {reaisEixo(t, Math.max(topo, -fundo))}
              </text>
            </g>
          ))}
          {fundo < 0 && <line className="grafico__base" x1={M.esq} x2={M.esq + w} y1={y(0)} y2={y(0)} />}
          {pontos.map((pt, i) => (
            <g key={pt.chave}>
              {i % passo === 0 && (
                <>
                  <text className="grafico__eixo" x={xCentro(i)} y={altura - 16} textAnchor="middle">
                    {pt.eixo[0]}
                  </text>
                  {pt.eixo[1] && (
                    <text className="grafico__eixo" x={xCentro(i)} y={altura - 4} textAnchor="middle">
                      {pt.eixo[1]}
                    </text>
                  )}
                </>
              )}
              <path
                className={`grafico__coluna${ativo === i ? ' grafico__coluna--ativa' : ''}`}
                d={coluna(i, pt.valorCentavos)}
              />
              {i === maior && pt.valorCentavos > 0 && (
                <text
                  className="grafico__rotulo"
                  x={xCentro(i)}
                  y={y(pt.valorCentavos) - 6}
                  textAnchor="middle"
                >
                  {formatarCentavos(pt.valorCentavos)}
                </text>
              )}
              {/* Área de toque: toda a faixa do grupo, maior que a coluna */}
              <rect
                x={M.esq + banda * i}
                y={M.topo}
                width={banda}
                height={h}
                fill="transparent"
                tabIndex={0}
                role="button"
                aria-label={`${pt.titulo}: ${formatarCentavos(pt.valorCentavos)}`}
                onPointerEnter={() => setAtivo(i)}
                onPointerLeave={() => setAtivo(null)}
                onFocus={() => setAtivo(i)}
                onBlur={() => setAtivo(null)}
              />
            </g>
          ))}
        </svg>
      )}
      {p && ativo !== null && (
        <div
          className="grafico__dica"
          style={{
            left: Math.min(Math.max(xCentro(ativo) - 100, 0), Math.max(largura - 210, 0)),
            top: Math.max(Math.min(y(p.valorCentavos), y(0)) - 100, 0),
          }}
          role="status"
        >
          <strong>{formatarCentavos(p.valorCentavos)}</strong>
          <span>{p.titulo}</span>
          {p.linhas.map((l) => (
            <span key={l} className="grafico__dica-linha">
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
