import { formatarPlaca } from '@estacionamento/shared';

/** Placa em destaque (formato de leitura fácil, monoespaçado). */
export function Placa({
  placa,
  grande,
  estrangeira,
}: {
  placa: string;
  grande?: boolean;
  estrangeira?: boolean;
}) {
  return (
    <span
      className={`placa${grande ? ' placa--grande' : ''}`}
      title={estrangeira ? 'Placa estrangeira' : undefined}
    >
      {formatarPlaca(placa)}
      {estrangeira && <span className="placa__ext">EXT</span>}
    </span>
  );
}
