import { useState } from 'react';
import type { MovimentoHora } from '@estacionamento/shared';
import { ticksBonitos, useLargura } from './util';

export interface CategoriaSerie {
  codigo: string;
  nome: string;
}

interface Props {
  horas: MovimentoHora[];
  categorias: CategoriaSerie[];
  altura?: number;
}

/**
 * Cores das categorias, sempre na mesma ordem (paleta validada para o fundo
 * escuro, inclusive para daltonismo): 1ª azul, 2ª laranja, depois aqua e
 * amarelo. A cor segue a categoria, nunca a posição na pilha.
 */
export const CORES_CATEGORIA = ['#3987e5', '#d95926', '#199e70', '#c98500'];

const M = { topo: 10, dir: 6, base: 30, esq: 30 };
const ESPACO = 2; // separação entre as fatias empilhadas e entre as duas colunas
const hh = (h: number) => `${String(h).padStart(2, '0')}h`;

/**
 * Movimentação por horário: em cada hora, duas colunas lado a lado —
 * Entradas (cheia) e Saídas (contorno + hachura) — empilhadas por categoria.
 */
export function GraficoMovimentoHora({ horas, categorias, altura = 190 }: Props) {
  const [ref, largura] = useLargura<HTMLDivElement>();
  const [ativo, setAtivo] = useState<number | null>(null);
  const cor = (codigo: string) =>
    CORES_CATEGORIA[categorias.findIndex((c) => c.codigo === codigo) % CORES_CATEGORIA.length] ?? '#94a3b8';

  const maior = Math.max(1, ...horas.flatMap((h) => [h.entradas, h.saidas]));
  const ticks = ticksBonitos(maior, 3, 1);
  const topo = ticks.at(-1)!;
  const w = Math.max(largura - M.esq - M.dir, 10);
  const h = altura - M.topo - M.base;
  const banda = w / Math.max(horas.length, 1);
  const coluna = Math.max(3, Math.min(14, (banda - ESPACO * 3) / 2));
  const y = (v: number) => M.topo + ((topo - v) / topo) * h;
  const passo = Math.max(1, Math.ceil(horas.length / Math.max(1, Math.floor(w / 34))));
  const legendaES = banda >= 26;

  /** Pilha de uma coluna: fatias por categoria, com 2px entre elas; ponta de cima arredondada. */
  const pilha = (i: number, lado: 0 | 1, campo: 'entradas' | 'saidas') => {
    const x0 = M.esq + banda * i + (banda - (coluna * 2 + ESPACO)) / 2 + lado * (coluna + ESPACO);
    let acumulado = 0;
    const fatias = categorias
      .map((c) => ({ c, v: horas[i]!.categorias[c.codigo]?.[campo] ?? 0 }))
      .filter((f) => f.v > 0);
    return fatias.map((f, k) => {
      const base = y(acumulado);
      acumulado += f.v;
      const ponta = y(acumulado);
      const alto = Math.max(0, base - ponta - (k < fatias.length - 1 ? ESPACO : 0));
      const ultima = k === fatias.length - 1;
      const r = ultima ? Math.min(3, alto / 2, coluna / 2) : 0;
      const topoY = base - alto;
      const x1 = x0 + coluna;
      const d =
        r > 0
          ? `M${x0},${base}V${topoY + r}Q${x0},${topoY} ${x0 + r},${topoY}H${x1 - r}Q${x1},${topoY} ${x1},${topoY + r}V${base}Z`
          : `M${x0},${base}V${topoY}H${x1}V${base}Z`;
      return (
        <path
          key={`${campo}-${f.c.codigo}`}
          d={d}
          fill={campo === 'entradas' ? cor(f.c.codigo) : `url(#hachura-${f.c.codigo})`}
          stroke={campo === 'saidas' ? cor(f.c.codigo) : 'none'}
          strokeWidth={campo === 'saidas' ? 1.5 : 0}
          opacity={ativo === null || ativo === i ? 1 : 0.55}
        />
      );
    });
  };

  const atual = ativo !== null ? horas[ativo] : undefined;
  const totalE = horas.reduce((t, x) => t + x.entradas, 0);
  const totalS = horas.reduce((t, x) => t + x.saidas, 0);

  return (
    <div className="grafico-mov">
      <ul className="grafico-mov__legenda" aria-label="Legenda">
        {categorias.map((c) => (
          <li key={c.codigo}>
            <span className="grafico-mov__cor" style={{ background: cor(c.codigo) }} aria-hidden="true" />
            {c.nome}
          </li>
        ))}
        <li>
          <span className="grafico-mov__cor grafico-mov__cor--cheia" aria-hidden="true" /> Entradas
        </li>
        <li>
          <span className="grafico-mov__cor grafico-mov__cor--hachura" aria-hidden="true" /> Saídas
        </li>
      </ul>
      <div ref={ref} className="grafico__area">
        {largura > 0 && (
          <svg
            width={largura}
            height={altura}
            role="img"
            aria-label={`Entradas e saídas por hora hoje, por tipo de veículo: ${totalE} entradas e ${totalS} saídas`}
          >
            <defs>
              {categorias.map((c) => (
                <pattern
                  key={c.codigo}
                  id={`hachura-${c.codigo}`}
                  width="4"
                  height="4"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="4" height="4" fill={cor(c.codigo)} opacity="0.18" />
                  <line x1="0" y1="0" x2="0" y2="4" stroke={cor(c.codigo)} strokeWidth="1.5" />
                </pattern>
              ))}
            </defs>
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
                  {t}
                </text>
              </g>
            ))}
            {horas.map((x, i) => {
              const centro = M.esq + banda * i + banda / 2;
              return (
                <g key={x.hora}>
                  {ativo === i && (
                    <rect
                      className="grafico-mov__faixa"
                      x={M.esq + banda * i}
                      y={M.topo}
                      width={banda}
                      height={h}
                    />
                  )}
                  {pilha(i, 0, 'entradas')}
                  {pilha(i, 1, 'saidas')}
                  {legendaES && (x.entradas > 0 || x.saidas > 0) && (
                    <>
                      <text
                        className="grafico-mov__es"
                        x={centro - (coluna + ESPACO) / 2}
                        y={y(0) + 10}
                        textAnchor="middle"
                      >
                        E
                      </text>
                      <text
                        className="grafico-mov__es"
                        x={centro + (coluna + ESPACO) / 2}
                        y={y(0) + 10}
                        textAnchor="middle"
                      >
                        S
                      </text>
                    </>
                  )}
                  {i % passo === 0 && (
                    <text className="grafico__eixo" x={centro} y={altura - 4} textAnchor="middle">
                      {hh(x.hora)}
                    </text>
                  )}
                  <rect
                    x={M.esq + banda * i}
                    y={M.topo}
                    width={banda}
                    height={h + 14}
                    fill="transparent"
                    tabIndex={0}
                    role="button"
                    aria-label={`${hh(x.hora)}: ${x.entradas} entradas e ${x.saidas} saídas`}
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
        {atual && ativo !== null && (
          <div
            className="grafico__dica"
            style={{
              left: Math.min(
                Math.max(M.esq + banda * ativo + banda / 2 - 105, 0),
                Math.max(largura - 220, 0),
              ),
              top: 0,
            }}
            role="status"
          >
            <strong>
              {hh(atual.hora)} – {String(atual.hora).padStart(2, '0')}:59
            </strong>
            <table className="grafico-mov__dica-tabela">
              <thead>
                <tr>
                  <th />
                  <th>Entradas</th>
                  <th>Saídas</th>
                </tr>
              </thead>
              <tbody>
                {categorias.map((c) => (
                  <tr key={c.codigo}>
                    <td>
                      <span
                        className="grafico-mov__cor"
                        style={{ background: cor(c.codigo) }}
                        aria-hidden="true"
                      />{' '}
                      {c.nome}
                    </td>
                    <td>{atual.categorias[c.codigo]?.entradas ?? 0}</td>
                    <td>{atual.categorias[c.codigo]?.saidas ?? 0}</td>
                  </tr>
                ))}
                <tr className="grafico-mov__dica-total">
                  <td>Total</td>
                  <td>{atual.entradas}</td>
                  <td>{atual.saidas}</td>
                </tr>
              </tbody>
            </table>
            <span className="grafico__dica-linha">
              Saldo da hora: {atual.entradas - atual.saidas > 0 ? '+' : ''}
              {atual.entradas - atual.saidas} veículo(s)
            </span>
          </div>
        )}
      </div>
      <details className="grafico-mov__tabela">
        <summary>Ver tabela</summary>
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th>Hora</th>
                {categorias.map((c) => (
                  <th key={`e${c.codigo}`} className="numero">
                    Entradas {c.nome.toLowerCase()}
                  </th>
                ))}
                {categorias.map((c) => (
                  <th key={`s${c.codigo}`} className="numero">
                    Saídas {c.nome.toLowerCase()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {horas
                .filter((x) => x.entradas || x.saidas)
                .map((x) => (
                  <tr key={x.hora}>
                    <td>{hh(x.hora)}</td>
                    {categorias.map((c) => (
                      <td key={`e${c.codigo}`} className="numero">
                        {x.categorias[c.codigo]?.entradas ?? 0}
                      </td>
                    ))}
                    {categorias.map((c) => (
                      <td key={`s${c.codigo}`} className="numero">
                        {x.categorias[c.codigo]?.saidas ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
