import { useEffect, useState } from 'react';
import { CONFIG_PADRAO } from '@estacionamento/shared';
import { configGeralApi, type DadosDoPainel } from '../services/configuracoes';

/**
 * Nome, logo e preferências de operação (Configurações). Lido uma vez e
 * compartilhado entre as telas; salvar nas Configurações chama
 * `recarregarConfigPainel()` e todas as telas recebem o valor novo.
 */
const PADRAO: DadosDoPainel = {
  nome: CONFIG_PADRAO.estacionamento.nome,
  logo: null,
  operacao: { ...CONFIG_PADRAO.operacao },
};
let atual: DadosDoPainel | null = null;
let pedido: Promise<void> | null = null;
const ouvintes = new Set<(d: DadosDoPainel) => void>();

function carregar(): Promise<void> {
  pedido ??= configGeralApi
    .painel()
    .then((d) => {
      atual = d;
      ouvintes.forEach((f) => f(d));
    })
    .catch(() => undefined)
    .finally(() => {
      pedido = null;
    });
  return pedido;
}

export function recarregarConfigPainel(): void {
  void carregar();
}

export function useConfigPainel(): DadosDoPainel {
  const [dados, setDados] = useState<DadosDoPainel>(atual ?? PADRAO);
  useEffect(() => {
    ouvintes.add(setDados);
    if (!atual) void carregar();
    return () => {
      ouvintes.delete(setDados);
    };
  }, []);
  return dados;
}
