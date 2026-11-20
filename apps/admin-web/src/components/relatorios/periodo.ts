import { hojeLocal } from '../financeiro/rotulos';

/** Datas "AAAA-MM-DD" (só navegação de calendário; os valores vêm do servidor). */
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const somarDias = (d: string, n: number) =>
  new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);

export type Atalho = 'hoje' | 'ontem' | '7d' | '30d' | 'mes' | 'mesPassado' | '12semanas' | '12meses' | 'ano';

export const ROTULO_ATALHO: Record<Atalho, string> = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  mes: 'Este mês',
  mesPassado: 'Mês passado',
  '12semanas': 'Últimas 12 semanas',
  '12meses': 'Últimos 12 meses',
  ano: 'Este ano',
};

export function periodoDoAtalho(a: Atalho): { de: string; ate: string } {
  const hoje = hojeLocal();
  const inicioMes = `${hoje.slice(0, 8)}01`;
  switch (a) {
    case 'hoje':
      return { de: hoje, ate: hoje };
    case 'ontem':
      return { de: somarDias(hoje, -1), ate: somarDias(hoje, -1) };
    case '7d':
      return { de: somarDias(hoje, -6), ate: hoje };
    case '30d':
      return { de: somarDias(hoje, -29), ate: hoje };
    case 'mes':
      return { de: inicioMes, ate: hoje };
    case 'mesPassado': {
      const fim = somarDias(inicioMes, -1);
      return { de: `${fim.slice(0, 8)}01`, ate: fim };
    }
    case '12semanas': {
      const d = new Date(ms(hoje)).getUTCDay();
      return { de: somarDias(hoje, -((d + 6) % 7) - 7 * 11), ate: hoje };
    }
    case '12meses': {
      const [a2, m] = hoje.split('-').map(Number);
      const inicio = new Date(Date.UTC(a2!, m! - 12, 1)).toISOString().slice(0, 10);
      return { de: inicio, ate: hoje };
    }
    case 'ano':
      return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje };
  }
}

const curto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
export const diaSemana = (d: string) =>
  new Date(`${d}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' })
    .replace('.', '');
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
export const mesAno = (d: string) => `${MESES[Number(d.slice(5, 7)) - 1]}/${d.slice(2, 4)}`;
export const dataBr = (d: string) => `${curto(d)}/${d.slice(0, 4)}`;
export const intervaloBr = (de: string, ate: string) =>
  de === ate ? dataBr(de) : `${dataBr(de)} a ${dataBr(ate)}`;
export { curto as diaMes };
