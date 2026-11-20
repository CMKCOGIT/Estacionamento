export { formatarCentavos as dinheiro, formatarPlaca } from '@estacionamento/shared';

export const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function dataHora(iso: string): string {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 1);
  const dia =
    d.toDateString() === hoje.toDateString()
      ? 'hoje'
      : d.toDateString() === ontem.toDateString()
        ? 'ontem'
        : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  return `${dia}, ${hora(iso)}`;
}

/** "2h 05min 12s" — o relógio da tela (o VALOR vem sempre da API). */
export function duracao(ms: number, comSegundos = true): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const partes = [
    d ? `${d}d` : '',
    d || h ? `${h}h` : '',
    `${String(m).padStart(d || h ? 2 : 1, '0')}min`,
    comSegundos && !d ? `${String(s % 60).padStart(2, '0')}s` : '',
  ];
  return partes.filter(Boolean).join(' ');
}

/** "agora", "há 3 min", "há 2 h". */
export function haQuanto(iso: string, agora = Date.now()): string {
  const min = Math.floor((agora - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.floor(h / 24)} dia(s)`;
}

/** "20/11/2026 às 14:32:05" — data e horário completos da última atualização. */
export function dataHoraCompleta(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })} às ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
}

/** "24 horas", "1 hora", "7 dias". */
export function horasPorExtenso(h: number): string {
  if (h % 24 === 0 && h >= 48) return `${h / 24} dias`;
  return h === 1 ? '1 hora' : `${h} horas`;
}
