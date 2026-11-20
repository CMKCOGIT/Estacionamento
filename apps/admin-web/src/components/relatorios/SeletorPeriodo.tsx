import { hojeLocal } from '../financeiro/rotulos';
import { periodoDoAtalho, ROTULO_ATALHO, type Atalho } from './periodo';

interface Props {
  de: string;
  ate: string;
  atalhos: Atalho[];
  onMudar: (p: { de: string; ate: string }) => void;
  children?: React.ReactNode;
}

/** Filtro de datas: atalhos comuns + período personalizado, numa linha acima do relatório. */
export function SeletorPeriodo({ de, ate, atalhos, onMudar, children }: Props) {
  const ativo = atalhos.find((a) => {
    const p = periodoDoAtalho(a);
    return p.de === de && p.ate === ate;
  });
  return (
    <div className="filtros cartao seletor-periodo">
      <div className="seletor-periodo__atalhos" role="group" aria-label="Período">
        {atalhos.map((a) => (
          <button
            key={a}
            type="button"
            className={`chip${ativo === a ? ' chip--ativo' : ''}`}
            aria-pressed={ativo === a}
            onClick={() => onMudar(periodoDoAtalho(a))}
          >
            {ROTULO_ATALHO[a]}
          </button>
        ))}
      </div>
      <label className="campo">
        <span>De</span>
        <input
          type="date"
          value={de}
          max={ate}
          onChange={(e) => e.target.value && onMudar({ de: e.target.value, ate })}
        />
      </label>
      <label className="campo">
        <span>Até</span>
        <input
          type="date"
          value={ate}
          min={de}
          max={hojeLocal()}
          onChange={(e) => e.target.value && onMudar({ de, ate: e.target.value })}
        />
      </label>
      {children}
    </div>
  );
}
