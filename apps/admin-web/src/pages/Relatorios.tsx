import { useEffect, useState } from 'react';
import type { FormaPagamento } from '@estacionamento/shared';
import {
  AbaFaturamento,
  AbaFechamentos,
  AbaFormas,
  AbaHistorico,
  AbaPendentes,
} from '../components/relatorios/Abas';
import { caixaApi } from '../services/sessoes';

type Aba = 'faturamento' | 'formas' | 'historico' | 'pendentes' | 'fechamentos';
const ABAS: [Aba, string][] = [
  ['faturamento', 'Faturamento'],
  ['formas', 'Formas de pagamento'],
  ['historico', 'Histórico de pagamentos'],
  ['pendentes', 'Pendentes'],
  ['fechamentos', 'Fechamentos de caixa'],
];

/** Relatórios financeiros com dados reais do banco, calculados pelo servidor. */
export function Relatorios() {
  const [aba, setAba] = useState<Aba>('faturamento');
  const [formas, setFormas] = useState<FormaPagamento[]>([]);
  useEffect(() => {
    caixaApi
      .formas()
      .then((r) => setFormas(r.itens))
      .catch(() => undefined);
  }, []);
  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Indicadores financeiros</h1>
          <p className="mudo">
            Faturamento, formas de pagamento, histórico, pendências e fechamentos de caixa.
          </p>
        </div>
      </header>
      <div className="abas abas--pagina" role="tablist">
        {ABAS.map(([id, rotulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={aba === id}
            className={aba === id ? 'aba aba--ativa' : 'aba'}
            onClick={() => setAba(id)}
          >
            {rotulo}
          </button>
        ))}
      </div>
      {aba === 'faturamento' && <AbaFaturamento />}
      {aba === 'formas' && <AbaFormas />}
      {aba === 'historico' && <AbaHistorico formas={formas} />}
      {aba === 'pendentes' && <AbaPendentes />}
      {aba === 'fechamentos' && <AbaFechamentos />}
    </>
  );
}
