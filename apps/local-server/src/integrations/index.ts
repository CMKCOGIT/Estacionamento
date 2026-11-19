import {
  cancelaInexistente,
  impressoraTela,
  leitorPlacaManual,
  sensorOcupacaoManual,
} from './manual/index.js';
import type { Integracoes } from './tipos.js';

export type * from './tipos.js';

/**
 * Integrações ativas. No futuro a escolha virá da configuração
 * (tabela `configuracoes` ou futura tabela `dispositivos`).
 */
export const integracoes: Integracoes = {
  leitorPlaca: leitorPlacaManual,
  sensorOcupacao: sensorOcupacaoManual,
  cancela: cancelaInexistente,
  impressora: impressoraTela,
};
