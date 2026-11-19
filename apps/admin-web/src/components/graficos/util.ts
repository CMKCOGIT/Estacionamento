import { useEffect, useRef, useState } from 'react';

/** Largura disponível do contêiner (gráficos responsivos). */
export function useLargura<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [largura, setLargura] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => setLargura(Math.floor(e?.contentRect.width ?? 0)));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, largura];
}

/**
 * Ticks "redondos" de 0 até pelo menos `max` (ex.: 0, 10, 20, 30).
 * `passoMinimo` evita ticks sem sentido (0,25 veículo; R$ 0,25 num eixo em reais).
 */
export function ticksBonitos(max: number, quantidade = 4, passoMinimo = 0): number[] {
  const alvo = Math.max(max, passoMinimo * quantidade, Number.EPSILON);
  const bruto = alvo / quantidade;
  const mag = 10 ** Math.floor(Math.log10(bruto));
  const candidato = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((p) => p >= bruto) ?? 10 * mag;
  // Com passo mínimo inteiro, só aceita múltiplos dele (nada de 2,5 veículos)
  const passo =
    passoMinimo > 0 ? Math.max(passoMinimo, Math.ceil(candidato / passoMinimo) * passoMinimo) : candidato;
  const topo = Math.ceil(alvo / passo) * passo;
  return Array.from({ length: Math.round(topo / passo) + 1 }, (_, i) => Math.round(i * passo * 100) / 100);
}

const reais = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});
const reaisCompacto = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  notation: 'compact',
  maximumFractionDigits: 1,
});

/** Eixo de dinheiro: inteiro até 10 mil, compacto acima. */
export function reaisEixo(centavos: number, topoCentavos: number): string {
  return topoCentavos >= 1_000_000 ? reaisCompacto.format(centavos / 100) : reais.format(centavos / 100);
}

export function horaLocal(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
