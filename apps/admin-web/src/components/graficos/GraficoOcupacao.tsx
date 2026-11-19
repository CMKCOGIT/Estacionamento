import { useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { PontoOcupacao } from '@estacionamento/shared';
import { horaLocal, ticksBonitos, useLargura } from './util';

interface Props {
  pontos: PontoOcupacao[];
  /** Vagas utilizáveis agora (total − em manutenção). Linha de referência. */
  capacidade: number;
}

const ALTURA = 220;
const M = { topo: 16, dir: 56, base: 26, esq: 34 };

/** Ocupação nas últimas 24h: uma série (linha + área) e a capacidade como referência. */
export function GraficoOcupacao({ pontos, capacidade }: Props) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tabela, setTabela] = useState(false);

  const maxValor = Math.max(capacidade, ...pontos.map((p) => p.ocupadas), 1);
  const ticks = ticksBonitos(maxValor, 4, 1); // veículos: só inteiros
  const topo = ticks.at(-1) ?? maxValor;
  const w = Math.max(largura - M.esq - M.dir, 10);
  const h = ALTURA - M.topo - M.base;
  const x = (i: number) => M.esq + (pontos.length <= 1 ? 0 : (i / (pontos.length - 1)) * w);
  const y = (v: number) => M.topo + h - (v / topo) * h;

  const linha = pontos
    .map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.ocupadas).toFixed(1)}`)
    .join('');
  const area = pontos.length ? `${linha}L${x(pontos.length - 1)},${y(0)}L${x(0)},${y(0)}Z` : '';
  const ultimo = pontos.length - 1;
  const atual = pontos[ultimo];

  const aoMover = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left - M.esq) / w) * (pontos.length - 1));
    setAtivo(Math.min(Math.max(i, 0), ultimo));
  };
  const aoTeclar = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') setAtivo((i) => Math.max((i ?? ultimo) - 1, 0));
    if (e.key === 'ArrowRight') setAtivo((i) => Math.min((i ?? ultimo) + 1, ultimo));
    if (e.key === 'Escape') setAtivo(null);
  };
  const pontoAtivo = ativo !== null ? pontos[ativo] : undefined;
  const pct = (v: number) =>
    capacidade > 0 ? ` · ${Math.round((v / capacidade) * 100)}% da capacidade` : '';

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
                <th>Horário</th>
                <th>Veículos</th>
              </tr>
            </thead>
            <tbody>
              {pontos.map((p, i) => (
                <tr key={p.em}>
                  <td>{i === ultimo ? `Agora (${horaLocal(p.em)})` : horaLocal(p.em)}</td>
                  <td className="numero">{p.ocupadas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="grafico__area">
          {largura > 0 && (
            <svg
              width={largura}
              height={ALTURA}
              role="img"
              aria-label={`Ocupação nas últimas 24 horas. Agora: ${atual?.ocupadas ?? 0} veículos de ${capacidade} vagas.`}
              tabIndex={0}
              onPointerMove={aoMover}
              onPointerLeave={() => setAtivo(null)}
              onKeyDown={aoTeclar}
              onBlur={() => setAtivo(null)}
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line className="grafico__grade" x1={M.esq} x2={M.esq + w} y1={y(t)} y2={y(t)} />
                  <text className="grafico__eixo" x={M.esq - 6} y={y(t)} dy="0.32em" textAnchor="end">
                    {t}
                  </text>
                </g>
              ))}
              {pontos.map((p, i) =>
                i % 6 === 0 && i !== ultimo ? (
                  <text key={p.em} className="grafico__eixo" x={x(i)} y={ALTURA - 6} textAnchor="middle">
                    {horaLocal(p.em)}
                  </text>
                ) : null,
              )}
              {capacidade > 0 && (
                <g>
                  <line
                    className="grafico__referencia"
                    x1={M.esq}
                    x2={M.esq + w}
                    y1={y(capacidade)}
                    y2={y(capacidade)}
                  />
                  <text className="grafico__rotulo-ref" x={M.esq + w + 6} y={y(capacidade)} dy="0.32em">
                    {capacidade} vagas
                  </text>
                </g>
              )}
              <path className="grafico__area-serie" d={area} />
              <path className="grafico__linha" d={linha} />
              {atual && (
                <g>
                  <circle className="grafico__ponto" cx={x(ultimo)} cy={y(atual.ocupadas)} r={4} />
                  <text className="grafico__rotulo" x={x(ultimo) + 8} y={y(atual.ocupadas)} dy="0.32em">
                    {atual.ocupadas}
                  </text>
                </g>
              )}
              {pontoAtivo && ativo !== null && (
                <g>
                  <line className="grafico__mira" x1={x(ativo)} x2={x(ativo)} y1={M.topo} y2={M.topo + h} />
                  <circle className="grafico__ponto" cx={x(ativo)} cy={y(pontoAtivo.ocupadas)} r={4} />
                </g>
              )}
            </svg>
          )}
          {pontoAtivo && ativo !== null && (
            <div
              className="grafico__dica"
              style={{
                left: Math.min(x(ativo) + 12, largura - 190),
                top: Math.max(y(pontoAtivo.ocupadas) - 48, 0),
              }}
              role="status"
            >
              <strong>
                {pontoAtivo.ocupadas} {pontoAtivo.ocupadas === 1 ? 'veículo' : 'veículos'}
              </strong>
              <span>
                {ativo === ultimo ? 'Agora' : horaLocal(pontoAtivo.em)}
                {pct(pontoAtivo.ocupadas)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
