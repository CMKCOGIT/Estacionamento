import { beforeEach, describe, expect, it } from 'vitest';
import type { TicketPublico } from '@estacionamento/shared';
import {
  apagarDadosPessoais,
  atualizarUltimo,
  esquecer,
  lerTickets,
  removerEncerrados,
  salvarToken,
} from '../src/armazenamento';
import { dataHoraCompleta, duracao, haQuanto, horasPorExtenso } from '../src/formato';
import {
  avaliarFrescor,
  INTERVALO_ATIVO_MS,
  LIMITE_AO_VIVO_MS,
  mensagemDeFalha,
  proximaConsultaEm,
} from '../src/consulta/regras';
import { estrategiaPara } from '../src/sw-regras';
import { tokenDoLink } from '../src/token';

const TOKEN = 'a'.repeat(22) + 'B_-' + '9'.repeat(18); // 43 caracteres base64url
const APP = 'https://app.exemplo.com.br';
const API = 'https://api.exemplo.com.br';

class Memoria implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear = () => this.m.clear();
  getItem = (k: string) => this.m.get(k) ?? null;
  key = (i: number) => [...this.m.keys()][i] ?? null;
  removeItem = (k: string) => void this.m.delete(k);
  setItem = (k: string, v: string) => void this.m.set(k, v);
}

describe('token do link', () => {
  it('lê o token depois do #, só no formato certo', () => {
    expect(tokenDoLink(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenDoLink(TOKEN)).toBe(TOKEN);
    expect(tokenDoLink('#curto')).toBeNull();
    expect(tokenDoLink(`#${TOKEN}x`)).toBeNull();
    expect(tokenDoLink('#<script>alert(1)</script>aaaaaaaaaaaaaaaaaaaaaaaaaa')).toBeNull();
    expect(tokenDoLink('')).toBeNull();
  });
});

describe('tickets guardados no celular', () => {
  beforeEach(() => {
    globalThis.localStorage = new Memoria();
  });

  it('guarda, move para o topo, limita a 5 e esquece', () => {
    const tokens = Array.from({ length: 6 }, (_, i) => `${i}`.repeat(43));
    for (const t of tokens) salvarToken(t);
    expect(lerTickets().map((t) => t.token)).toEqual(tokens.slice(1).reverse());
    salvarToken(tokens[2]!);
    expect(lerTickets()[0]!.token).toBe(tokens[2]);
    expect(esquecer(tokens[2]!).some((t) => t.token === tokens[2])).toBe(false);
  });

  it('guarda a última resposta para mostrar sem internet', () => {
    salvarToken(TOKEN);
    atualizarUltimo(TOKEN, { numero: '7' } as TicketPublico, new Date('2026-11-20T10:00:00Z'));
    expect(lerTickets()[0]).toMatchObject({ ultimo: { numero: '7' }, ultimoEm: '2026-11-20T10:00:00.000Z' });
  });

  it('política de encerramento: tickets com acesso vencido saem do celular', () => {
    const agora = Date.parse('2026-11-20T12:00:00Z');
    const vencido = 'v'.repeat(43);
    const valendo = 'w'.repeat(43);
    const aberto = 'x'.repeat(43);
    for (const t of [vencido, valendo, aberto]) salvarToken(t);
    atualizarUltimo(vencido, { acessoExpiraEm: '2026-11-20T11:59:00Z' } as TicketPublico);
    atualizarUltimo(valendo, { acessoExpiraEm: '2026-11-21T08:00:00Z' } as TicketPublico);
    atualizarUltimo(aberto, { acessoExpiraEm: null } as TicketPublico);
    const r = removerEncerrados(agora);
    expect(r.removidos).toBe(1);
    expect(r.lista.map((t) => t.token).sort()).toEqual([aberto, valendo].sort());
    expect(lerTickets()).toHaveLength(2);
  });

  it('acesso encerrado: apaga placa e valores guardados', () => {
    salvarToken(TOKEN);
    atualizarUltimo(TOKEN, {
      numero: '9',
      placa: 'ABC1D23',
      vaga: 'A-01',
      valorCentavos: 1400,
      itens: [{ descricao: '1ª hora' }],
    } as TicketPublico);
    apagarDadosPessoais(TOKEN);
    expect(lerTickets()[0]!.ultimo).toMatchObject({
      numero: '9',
      placa: '',
      vaga: null,
      valorCentavos: 0,
      itens: [],
    });
  });

  it('sem localStorage (modo privado/bloqueado) não quebra o app', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('bloqueado');
      },
    });
    expect(lerTickets()).toEqual([]);
    expect(() => salvarToken(TOKEN)).not.toThrow();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: new Memoria(),
      writable: true,
    });
  });

  it('dados corrompidos são ignorados', () => {
    localStorage.setItem('meu-ticket:tickets', '{nao é json');
    expect(lerTickets()).toEqual([]);
  });
});

describe('cache do service worker', () => {
  const regra = (
    url: string,
    extra: Partial<{ method: string; mode: string; temAutorizacao: boolean }> = {},
  ) => estrategiaPara({ url, method: 'GET', ...extra }, APP, API);

  it('o ticket NUNCA vai para cache', () => {
    expect(regra(`${API}/v1/ticket`)).toBe('somente-rede');
    expect(regra(`${API}/v1/sites/centro/tarifas`, { temAutorizacao: true })).toBe('somente-rede');
  });
  it('vagas e tarifas: rede primeiro com cópia offline; app sempre disponível', () => {
    expect(regra(`${API}/v1/sites/centro/disponibilidade`)).toBe('dados-publicos');
    expect(regra(`${API}/v1/sites/centro/tarifas`)).toBe('dados-publicos');
    expect(regra(`${APP}/assets/app-123.js`)).toBe('app');
    expect(regra(`${APP}/ticket`, { mode: 'navigate' })).toBe('navegacao');
  });
  it('outros domínios, outros métodos e o próprio sw.js ficam de fora', () => {
    expect(regra('https://outro.com/x.js')).toBe('ignorar');
    expect(regra(`${API}/v1/ticket`, { method: 'POST' })).toBe('ignorar');
    expect(regra(`${APP}/sw.js`)).toBe('ignorar');
    expect(regra(`${API}/outra-coisa`)).toBe('ignorar');
  });
});

describe('formatos', () => {
  it('duração e "há quanto tempo"', () => {
    expect(duracao(65_000)).toBe('1min 05s');
    expect(duracao(2 * 3600_000 + 5 * 60_000 + 12_000)).toBe('2h 05min 12s');
    expect(duracao(26 * 3600_000, false)).toBe('1d 2h 00min');
    const agora = Date.parse('2026-11-20T12:00:00Z');
    expect(haQuanto('2026-11-20T11:59:30Z', agora)).toBe('agora');
    expect(haQuanto('2026-11-20T11:45:00Z', agora)).toBe('há 15 min');
  });
});

describe('textos da consulta do ticket', () => {
  it('data e horário completos da última atualização; prazos por extenso', () => {
    expect(dataHoraCompleta('2026-11-20T14:32:05')).toMatch(/^20\/11\/2026 às 14:32:05$/);
    expect(horasPorExtenso(1)).toBe('1 hora');
    expect(horasPorExtenso(24)).toBe('24 horas');
    expect(horasPorExtenso(72)).toBe('3 dias');
    expect(horasPorExtenso(168)).toBe('7 dias');
  });
});

describe('atualização periódica do ticket', () => {
  const base = {
    situacao: 'ESTACIONADO' as const,
    proximaCobrancaEm: null,
    desvioRelogioMs: 0,
    falhasSeguidas: 0,
    ultimaFalha: null,
    agora: Date.parse('2026-11-20T12:00:00Z'),
  };

  it('estacionado: a cada 30 s, ou no instante em que o valor sobe', () => {
    expect(proximaConsultaEm(base)).toBe(INTERVALO_ATIVO_MS);
    expect(proximaConsultaEm({ ...base, proximaCobrancaEm: '2026-11-20T12:00:10Z' })).toBe(11_000);
    // celular 5 min adiantado: a hora da cobrança é convertida para o relógio do celular
    expect(
      proximaConsultaEm({
        ...base,
        proximaCobrancaEm: '2026-11-20T12:00:10Z',
        desvioRelogioMs: -5 * 60_000,
        agora: base.agora + 5 * 60_000,
      }),
    ).toBe(11_000);
    expect(proximaConsultaEm({ ...base, proximaCobrancaEm: '2026-11-20T12:10:00Z' })).toBe(
      INTERVALO_ATIVO_MS,
    );
  });

  it('falhas: novas tentativas com espera crescente, até 1 min; link encerrado não tenta mais', () => {
    const esperas = [1, 2, 3, 4, 5, 9].map((n) =>
      proximaConsultaEm({ ...base, falhasSeguidas: n, ultimaFalha: 'INDISPONIVEL' }),
    );
    expect(esperas).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);
    expect(proximaConsultaEm({ ...base, falhasSeguidas: 1, ultimaFalha: 'MUITAS_TENTATIVAS' })).toBe(60_000);
    expect(proximaConsultaEm({ ...base, falhasSeguidas: 1, ultimaFalha: 'NAO_ENCONTRADO' })).toBeNull();
    // falha também em ticket encerrado: tenta de novo (o cliente pode estar vendo dados antigos)
    expect(
      proximaConsultaEm({ ...base, situacao: 'ENCERRADO', falhasSeguidas: 1, ultimaFalha: 'SEM_CONEXAO' }),
    ).toBe(5_000);
  });

  it('encerrado ou cancelado não muda mais: para de consultar', () => {
    expect(proximaConsultaEm({ ...base, situacao: 'ENCERRADO' })).toBeNull();
    expect(proximaConsultaEm({ ...base, situacao: 'CANCELADO' })).toBeNull();
  });

  it('dados ao vivo só com consulta recente bem-sucedida e o estacionamento enviando dados', () => {
    const agora = Date.parse('2026-11-20T12:00:00Z');
    const f = {
      recebidoEm: agora - 10_000,
      falhando: false,
      calculadoEm: '2026-11-20T11:59:50Z',
      sincronizadoEm: '2026-11-20T11:59:40Z',
      agora,
    };
    expect(avaliarFrescor(f)).toBe('AO_VIVO');
    expect(avaliarFrescor({ ...f, falhando: true })).toBe('DESATUALIZADO');
    expect(avaliarFrescor({ ...f, recebidoEm: null })).toBe('DESATUALIZADO'); // só a cópia guardada
    expect(avaliarFrescor({ ...f, recebidoEm: agora - LIMITE_AO_VIVO_MS - 1 })).toBe('DESATUALIZADO');
    expect(avaliarFrescor({ ...f, sincronizadoEm: '2026-11-20T11:50:00Z' })).toBe('SEM_SINCRONIA');
  });

  it('mensagens de indisponibilidade para cada falha', () => {
    expect(mensagemDeFalha('SEM_CONEXAO')).toMatch(/internet/);
    expect(mensagemDeFalha('TEMPO_ESGOTADO')).toMatch(/não respondeu/);
    expect(mensagemDeFalha('INDISPONIVEL')).toMatch(/indisponível/);
  });
});
