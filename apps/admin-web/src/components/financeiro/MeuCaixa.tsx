import { useCallback, useState } from 'react';
import { formatarCentavos, type CaixaAtual } from '@estacionamento/shared';
import { useAuth } from '../../auth/contexto';
import { useCarregar } from '../../hooks/useCarregar';
import { financeiroApi } from '../../services/financeiro';
import { formatarDataHora } from '../../services/rotulos';
import { BarraCaixa } from '../operacao/BarraCaixa';
import { DialogoCaixa, ResumoDoCaixa } from './DialogoCaixa';
import { DialogoMovimentar } from './DialogoMovimentar';
import { TabelaMovimentacoes } from './Tabelas';

interface Props {
  caixa: CaixaAtual | null;
  carregandoCaixa: boolean;
  pedirAbertura: boolean;
  onPedidoAtendido: () => void;
  onMudou: (msg: string) => void;
}

/** Caixa do operador logado: abrir/fechar, sangria/suprimento e tudo o que entrou e saiu. */
export function MeuCaixa({ caixa, carregandoCaixa, pedirAbertura, onPedidoAtendido, onMudou }: Props) {
  const { temPermissao } = useAuth();
  const [movimentar, setMovimentar] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null);
  const [vendo, setVendo] = useState<string | null>(null);
  const carregarDetalhe = useCallback(
    () => (caixa ? financeiroApi.caixa(caixa.id) : Promise.resolve(null)),
    [caixa],
  );
  const detalhe = useCarregar(carregarDetalhe);
  const carregarAnteriores = useCallback(() => financeiroApi.caixas(), []);
  const anteriores = useCarregar(carregarAnteriores);
  const mudou = (msg: string) => {
    onMudou(msg);
    detalhe.recarregar();
    anteriores.recarregar();
  };

  return (
    <>
      <BarraCaixa
        caixa={caixa}
        carregando={carregandoCaixa}
        pedirAbertura={pedirAbertura}
        onPedidoAtendido={onPedidoAtendido}
        onMudou={mudou}
      />
      {caixa && temPermissao('caixa.sangria') && (
        <div className="acoes">
          <button type="button" className="botao botao--secundario" onClick={() => setMovimentar('SANGRIA')}>
            Sangria (retirar dinheiro)
          </button>
          <button
            type="button"
            className="botao botao--secundario"
            onClick={() => setMovimentar('SUPRIMENTO')}
          >
            Suprimento (colocar troco)
          </button>
        </div>
      )}
      {caixa && detalhe.dados && (
        <section className="cartao">
          <h2>Caixa aberto</h2>
          <ResumoDoCaixa c={detalhe.dados} />
          <h3 className="pequeno">Movimentações</h3>
          <TabelaMovimentacoes itens={[...detalhe.dados.movimentacoes].reverse()} semCaixa />
        </section>
      )}
      {anteriores.dados && anteriores.dados.itens.some((c) => c.status === 'FECHADO') && (
        <section className="cartao">
          <h2>Caixas fechados hoje</h2>
          <ul className="lista-simples">
            {anteriores.dados.itens
              .filter((c) => c.status === 'FECHADO')
              .map((c) => (
                <li key={c.id}>
                  {c.posto} · {c.operador} · {formatarDataHora(c.abertoEm)} → {formatarDataHora(c.fechadoEm)}{' '}
                  · recebido {formatarCentavos(c.recebidoCentavos)}
                  {c.diferencaCentavos ? (
                    <span className="erro"> · diferença {formatarCentavos(c.diferencaCentavos)}</span>
                  ) : (
                    ''
                  )}{' '}
                  <button type="button" className="botao-texto" onClick={() => setVendo(c.id)}>
                    Ver
                  </button>
                </li>
              ))}
          </ul>
        </section>
      )}
      {movimentar && (
        <DialogoMovimentar
          tipo={movimentar}
          onFechar={() => setMovimentar(null)}
          onFeito={(t) => {
            setMovimentar(null);
            mudou(t);
          }}
        />
      )}
      {vendo && (
        <DialogoCaixa caixaId={vendo} podeFechar={false} onFechar={() => setVendo(null)} onMudou={mudou} />
      )}
    </>
  );
}
