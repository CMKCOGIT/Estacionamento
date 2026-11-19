/**
 * Conferência dos pagamentos da saída: completa a linha automática com o que
 * falta, calcula o troco e aponta cada problema. A prévia da tela e o
 * encerramento usam esta mesma função, então a tela nunca "acha" um valor
 * diferente do que o servidor aceita.
 */
import { formatarCentavos } from '@estacionamento/shared';

export interface FormaParaConferencia {
  codigo: string;
  nome: string;
  permiteTroco: boolean;
  permiteParcelas: boolean;
}

export interface PagamentoInformado {
  forma: string;
  /** null = automático: completa o que faltar do valor a pagar (no máximo uma linha). */
  valorCentavos: number | null;
  /** Só formas com troco (dinheiro): quanto o cliente entregou. */
  valorRecebidoCentavos?: number | null;
  parcelas?: number;
}

export interface ProblemaPagamento {
  /** DADOS = pedido mal formado (400); REGRA = regra de negócio (422). */
  tipo: 'DADOS' | 'REGRA';
  mensagem: string;
  /** Índice da linha informada, quando o problema é de uma linha. */
  linha?: number;
}

export interface PagamentoConferido {
  /** Índice da linha informada. */
  linha: number;
  forma: string;
  formaNome: string;
  valorCentavos: number;
  valorRecebidoCentavos: number | null;
  trocoCentavos: number;
  parcelas: number;
  automatico: boolean;
}

export interface Conferencia {
  pagamentos: PagamentoConferido[];
  somaCentavos: number;
  /** a pagar − soma: positivo = falta, negativo = sobra. */
  diferencaCentavos: number;
  trocoTotalCentavos: number;
  problemas: ProblemaPagamento[];
}

export function conferirPagamentos(
  aPagarCentavos: number,
  informados: PagamentoInformado[],
  formas: Iterable<FormaParaConferencia>,
): Conferencia {
  const porCodigo = new Map([...formas].map((f) => [f.codigo, f]));
  const problemas: ProblemaPagamento[] = [];
  const automaticas = informados.filter((p) => p.valorCentavos === null).length;
  if (automaticas > 1) {
    problemas.push({ tipo: 'DADOS', mensagem: 'Só um pagamento pode completar o valor automaticamente.' });
  }
  const somaFixos = informados.reduce((t, p) => t + (p.valorCentavos ?? 0), 0);
  const restante = Math.max(0, aPagarCentavos - somaFixos);

  const linhas: PagamentoConferido[] = [];
  const problemasDasLinhas: ProblemaPagamento[] = [];
  informados.forEach((p, linha) => {
    const automatico = p.valorCentavos === null;
    const valor = automatico ? restante : p.valorCentavos!;
    // Linha automática sem nada a completar (ex.: dentro da tolerância) simplesmente não existe
    if (automatico && valor === 0) return;
    const forma = porCodigo.get(p.forma);
    if (!forma) {
      problemasDasLinhas.push({ tipo: 'DADOS', mensagem: `Forma de pagamento inválida: ${p.forma}`, linha });
      return;
    }
    if (!Number.isInteger(valor) || valor <= 0) {
      problemasDasLinhas.push({
        tipo: 'DADOS',
        mensagem: 'Cada pagamento precisa ter valor maior que zero',
        linha,
      });
    }
    const recebido = p.valorRecebidoCentavos ?? null;
    if (recebido !== null && !forma.permiteTroco) {
      problemasDasLinhas.push({
        tipo: 'DADOS',
        mensagem: `${forma.nome} não tem troco: informe só o valor.`,
        linha,
      });
    } else if (recebido !== null && recebido < valor) {
      problemasDasLinhas.push({
        tipo: 'REGRA',
        mensagem: `Valor recebido em ${forma.nome} menor que o valor do pagamento.`,
        linha,
      });
    }
    linhas.push({
      linha,
      forma: forma.codigo,
      formaNome: forma.nome,
      valorCentavos: valor,
      valorRecebidoCentavos: recebido,
      trocoCentavos: recebido !== null && forma.permiteTroco ? Math.max(0, recebido - valor) : 0,
      parcelas: forma.permiteParcelas ? (p.parcelas ?? 1) : 1,
      automatico,
    });
  });

  const soma = linhas.reduce((t, l) => t + l.valorCentavos, 0);
  if (soma !== aPagarCentavos) {
    problemas.push({
      tipo: 'REGRA',
      mensagem: `Os pagamentos somam ${formatarCentavos(soma)}, mas o valor a pagar é ${formatarCentavos(aPagarCentavos)}.`,
    });
  }
  return {
    pagamentos: linhas,
    somaCentavos: soma,
    diferencaCentavos: aPagarCentavos - soma,
    trocoTotalCentavos: linhas.reduce((t, l) => t + l.trocoCentavos, 0),
    problemas: [...problemas, ...problemasDasLinhas],
  };
}
