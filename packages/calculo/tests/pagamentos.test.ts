import { describe, expect, it } from 'vitest';
import { conferirPagamentos, type FormaParaConferencia } from '../src/index.js';

const FORMAS: FormaParaConferencia[] = [
  { codigo: 'DINHEIRO', nome: 'Dinheiro', permiteTroco: true, permiteParcelas: false },
  { codigo: 'PIX', nome: 'Pix', permiteTroco: false, permiteParcelas: false },
  { codigo: 'CREDITO', nome: 'Crédito', permiteTroco: false, permiteParcelas: true },
];
const mensagens = (c: ReturnType<typeof conferirPagamentos>) => c.problemas.map((p) => p.mensagem);

describe('conferirPagamentos', () => {
  it('linha automática completa o valor a pagar; troco do dinheiro', () => {
    const c = conferirPagamentos(
      2000,
      [{ forma: 'DINHEIRO', valorCentavos: null, valorRecebidoCentavos: 5000 }],
      FORMAS,
    );
    expect(c.problemas).toEqual([]);
    expect(c.pagamentos).toEqual([
      expect.objectContaining({
        forma: 'DINHEIRO',
        valorCentavos: 2000,
        trocoCentavos: 3000,
        automatico: true,
      }),
    ]);
    expect(c.trocoTotalCentavos).toBe(3000);
  });

  it('dividido: a linha automática fica com o que sobrar das outras', () => {
    const c = conferirPagamentos(
      3500,
      [
        { forma: 'DINHEIRO', valorCentavos: null },
        { forma: 'PIX', valorCentavos: 1000 },
      ],
      FORMAS,
    );
    expect(c.pagamentos.map((p) => [p.forma, p.valorCentavos])).toEqual([
      ['DINHEIRO', 2500],
      ['PIX', 1000],
    ]);
    expect(c.diferencaCentavos).toBe(0);
  });

  it('nada a pagar (tolerância): a linha automática some e não há problema', () => {
    const c = conferirPagamentos(0, [{ forma: 'DINHEIRO', valorCentavos: null }], FORMAS);
    expect(c.pagamentos).toEqual([]);
    expect(c.problemas).toEqual([]);
  });

  it('soma diferente do valor a pagar: aponta quanto falta ou sobra', () => {
    const falta = conferirPagamentos(2000, [{ forma: 'PIX', valorCentavos: 1500 }], FORMAS);
    expect(falta.diferencaCentavos).toBe(500);
    expect(mensagens(falta)[0]).toMatch(/somam R\$\s15,00, mas o valor a pagar é R\$\s20,00/);
    const sobra = conferirPagamentos(2000, [{ forma: 'PIX', valorCentavos: 2500 }], FORMAS);
    expect(sobra.diferencaCentavos).toBe(-500);
  });

  it('troco só em dinheiro; recebido menor que o valor; forma inválida; valor zero', () => {
    const c = conferirPagamentos(
      2000,
      [
        { forma: 'PIX', valorCentavos: 1000, valorRecebidoCentavos: 2000 },
        { forma: 'DINHEIRO', valorCentavos: 1000, valorRecebidoCentavos: 500 },
      ],
      FORMAS,
    );
    expect(c.problemas).toEqual([
      expect.objectContaining({
        tipo: 'DADOS',
        linha: 0,
        mensagem: 'Pix não tem troco: informe só o valor.',
      }),
      expect.objectContaining({
        tipo: 'REGRA',
        linha: 1,
        mensagem: 'Valor recebido em Dinheiro menor que o valor do pagamento.',
      }),
    ]);
    expect(mensagens(conferirPagamentos(100, [{ forma: 'BOLETO', valorCentavos: 100 }], FORMAS))[1]).toMatch(
      /inválida: BOLETO/,
    );
    expect(
      mensagens(
        conferirPagamentos(
          100,
          [
            { forma: 'PIX', valorCentavos: 100 },
            { forma: 'PIX', valorCentavos: 0 },
          ],
          FORMAS,
        ),
      ),
    ).toContain('Cada pagamento precisa ter valor maior que zero');
  });

  it('parcelas só onde a forma permite; só uma linha automática', () => {
    const c = conferirPagamentos(
      1000,
      [
        { forma: 'CREDITO', valorCentavos: 600, parcelas: 3 },
        { forma: 'PIX', valorCentavos: 400, parcelas: 3 },
      ],
      FORMAS,
    );
    expect(c.pagamentos.map((p) => p.parcelas)).toEqual([3, 1]);
    const duas = conferirPagamentos(
      1000,
      [
        { forma: 'PIX', valorCentavos: null },
        { forma: 'DINHEIRO', valorCentavos: null },
      ],
      FORMAS,
    );
    expect(mensagens(duas)[0]).toMatch(/Só um pagamento pode completar/);
  });
});
