import { formatarPlaca } from '../formato';

/** Placa no estilo Mercosul. */
export function Placa({ placa }: { placa: string }) {
  return (
    <span className="placa" aria-label={`Placa ${formatarPlaca(placa)}`}>
      <span className="placa__faixa" aria-hidden="true">
        BRASIL
      </span>
      <span className="placa__texto">{formatarPlaca(placa)}</span>
    </span>
  );
}
