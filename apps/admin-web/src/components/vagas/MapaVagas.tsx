/** Tempo de permanência curto: "42 min", "3h05", "2d 4h". */
export function duracaoCurta(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h${String(min % 60).padStart(2, '0')}` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
