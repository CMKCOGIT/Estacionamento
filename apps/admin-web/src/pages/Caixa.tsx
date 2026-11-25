import { useCallback, useEffect, useState } from 'react';
import type { FormaPagamento } from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { AbaMovimentacoes, AbaPagamentos, AbaPendentes, AbaResumo } from '../components/financeiro/Abas';
import { CaixasAnteriores } from '../components/financeiro/CaixasAnteriores';
import { MeuCaixa } from '../components/financeiro/MeuCaixa';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { caixaApi } from '../services/sessoes';

type Aba = 'meu' | 'resumo' | 'pagamentos' | 'pendentes' | 'movimentacoes' | 'anteriores';

/** Caixa e financeiro: caixa do operador, resumo do dia, pagamentos, pendências e movimentações. */
export function Caixa() {
  const { temPermissao } = useAuth();
  const supervisiona = temPermissao('relatorio.financeiro') || temPermissao('caixa.supervisionar');
  const operaCaixa = temPermissao('caixa.operar');
  const vePendentes = supervisiona || temPermissao('sessao.saida') || temPermissao('pagamento.registrar');
  const abas = (
    [
      operaCaixa && ['meu', 'Meu caixa'],
      supervisiona && ['resumo', 'Resumo do dia'],
      vePendentes && ['pendentes', 'Pendentes'],
      supervisiona && ['pagamentos', 'Pagamentos'],
      supervisiona && ['movimentacoes', 'Movimentações'],
      supervisiona && ['anteriores', 'Caixas anteriores'],
    ] as (false | [Aba, string])[]
  ).filter((x): x is [Aba, string] => !!x);
  const [aba, setAba] = useState<Aba>(abas[0]?.[0] ?? 'pendentes');
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [pedirCaixa, setPedirCaixa] = useState(false);
  const [formas, setFormas] = useState<FormaPagamento[]>([]);

  useEffect(() => {
    caixaApi
      .formas()
      .then((r) => setFormas(r.itens))
      .catch(() => undefined);
  }, []);
  const carregarCaixa = useCallback(
    () => (operaCaixa ? caixaApi.atual() : Promise.resolve({ caixa: null })),
    [operaCaixa],
  );
  const caixa = useAtualizacaoAutomatica(carregarCaixa, 30_000);
  const avisar = (tipo: 'ok' | 'erro', texto: string) => {
    setMensagem({ tipo, texto });
    caixa.atualizarAgora();
  };

  return (
    <>
      <header className="cabecalho">
        <div>
          <h1>Caixa e financeiro</h1>
          <p className="mudo">Pagamentos, pendências, movimentações, abertura e fechamento de caixa.</p>
        </div>
      </header>
      {mensagem && (
        <p className={`alerta alerta--${mensagem.tipo}`} role="status">
          {mensagem.texto}
        </p>
      )}
      <div className="abas abas--pagina" role="tablist">
        {abas.map(([id, rotulo]) => (
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
      {aba === 'meu' && (
        <MeuCaixa
          caixa={caixa.dados?.caixa ?? null}
          carregandoCaixa={caixa.atualizando}
          pedirAbertura={pedirCaixa}
          onPedidoAtendido={() => setPedirCaixa(false)}
          onMudou={(t) => avisar('ok', t)}
        />
      )}
      {aba === 'resumo' && <AbaResumo avisar={avisar} />}
      {aba === 'pendentes' && (
        <AbaPendentes
          formas={formas}
          avisar={avisar}
          onAbrirCaixa={() => {
            setAba('meu');
            setPedirCaixa(true);
          }}
        />
      )}
      {aba === 'pagamentos' && <AbaPagamentos formas={formas} avisar={avisar} />}
      {aba === 'movimentacoes' && <AbaMovimentacoes formas={formas} />}
      {aba === 'anteriores' && <CaixasAnteriores formas={formas} avisar={avisar} />}
    </>
  );
}
