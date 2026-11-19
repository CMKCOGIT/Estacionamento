import type { EstadoVaga, Vaga } from '@estacionamento/shared';
import { formatarPlaca } from '@estacionamento/shared';

export const ESTADOS: Record<EstadoVaga, { rotulo: string; icone: string }> = {
  LIVRE: { rotulo: 'Disponível', icone: '✓' },
  OCUPADA: { rotulo: 'Ocupada', icone: '●' },
  BLOQUEADA: { rotulo: 'Bloqueada', icone: '⊘' },
  REMOVIDA: { rotulo: 'Removida', icone: '–' },
};

export function duracaoCurta(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

interface Props {
  vagas: Vaga[];
  selecionada: string | null;
  onSelecionar: (id: string) => void;
}

/** Mapa visual: uma "pastilha" por vaga, agrupadas por setor. */
export function MapaVagas({ vagas, selecionada, onSelecionar }: Props) {
  const setores = new Map<string, Vaga[]>();
  for (const v of vagas) {
    const s = v.setor ?? '';
    if (!setores.has(s)) setores.set(s, []);
    setores.get(s)!.push(v);
  }

  return (
    <div className="mapa">
      {[...setores.entries()].map(([setor, lista]) => (
        <section
          key={setor || '_'}
          className="mapa__setor"
          aria-label={setor ? `Setor ${setor}` : 'Sem setor'}
        >
          <h3>
            {setor || 'Sem setor'}{' '}
            <span className="mudo">
              · {lista.length} vaga{lista.length === 1 ? '' : 's'}
            </span>
          </h3>
          <div className="mapa__grade">
            {lista.map((v) => {
              const e = ESTADOS[v.estado];
              return (
                <button
                  key={v.id}
                  type="button"
                  className={`vaga vaga--${v.estado.toLowerCase()}${selecionada === v.id ? ' vaga--selecionada' : ''}`}
                  onClick={() => onSelecionar(v.id)}
                  aria-pressed={selecionada === v.id}
                  aria-label={`Vaga ${v.codigo}, ${v.categoria}: ${e.rotulo}${v.ocupacao ? `, placa ${formatarPlaca(v.ocupacao.placa)}` : ''}${v.bloqueio ? `, ${v.bloqueio.motivo}` : ''}`}
                  title={v.bloqueio ? `Bloqueada: ${v.bloqueio.motivo}` : undefined}
                >
                  <span className="vaga__codigo">{v.codigo}</span>
                  <span className="vaga__estado">
                    <span className="vaga__icone" aria-hidden="true">
                      {e.icone}
                    </span>
                    {e.rotulo}
                  </span>
                  {v.ocupacao && (
                    <span className="vaga__info">
                      {formatarPlaca(v.ocupacao.placa)} · {duracaoCurta(v.ocupacao.permanenciaMin)}
                    </span>
                  )}
                  {v.bloqueio && <span className="vaga__info">{v.bloqueio.motivo}</span>}
                  {!v.ocupacao && !v.bloqueio && (
                    <span className="vaga__info vaga__info--categoria">{v.categoria}</span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
