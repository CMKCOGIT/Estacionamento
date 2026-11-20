import { formatarCentavos, type Movimentacao, type PagamentoRegistro } from '@estacionamento/shared';
import { formatarDataHora } from '../../services/rotulos';
import { horaCurta } from '../operacao/util';
import { ROTULO_MOVIMENTACAO } from './rotulos';

export function TabelaMovimentacoes({
  itens,
  semCaixa,
  onDetalhe,
}: {
  itens: Movimentacao[];
  semCaixa?: boolean;
  onDetalhe?: (m: Movimentacao) => void;
}) {
  if (!itens.length) return <p className="mudo">Nenhuma movimentação.</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela--compacta">
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Tipo</th>
            <th scope="col">Forma</th>
            <th scope="col" className="numero">
              Valor
            </th>
            <th scope="col">Ticket</th>
            {!semCaixa && <th scope="col">Caixa</th>}
            <th scope="col">Por</th>
            <th scope="col">Descrição</th>
            {onDetalhe && (
              <th scope="col">
                <span className="sr-only">Detalhes</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {itens.map((m) => (
            <tr key={m.id}>
              <td className="sem-quebra">
                {semCaixa ? horaCurta(m.registradoEm) : formatarDataHora(m.registradoEm)}
              </td>
              <td>
                <span className={`etiqueta etiqueta--mov-${m.direcao === 'ENTRADA' ? 'entrada' : 'saida'}`}>
                  {ROTULO_MOVIMENTACAO[m.tipo]}
                </span>
              </td>
              <td>{m.formaNome}</td>
              <td className={`numero ${m.direcao === 'SAIDA' ? 'valor-saida' : ''}`}>
                {m.direcao === 'SAIDA' ? '− ' : ''}
                {formatarCentavos(m.valorCentavos)}
              </td>
              <td>{m.ticketNumero ? `nº ${m.ticketNumero} · ${m.placa}` : '—'}</td>
              {!semCaixa && <td>{m.posto ?? '—'}</td>}
              <td>{m.registradoPor ?? '—'}</td>
              <td>{m.descricao ?? ''}</td>
              {onDetalhe && (
                <td>
                  <button type="button" className="botao-texto" onClick={() => onDetalhe(m)}>
                    Detalhes
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TabelaPagamentos({
  itens,
  onEstornar,
  onDetalhe,
}: {
  itens: PagamentoRegistro[];
  onEstornar?: (p: PagamentoRegistro) => void;
  onDetalhe?: (p: PagamentoRegistro) => void;
}) {
  if (!itens.length) return <p className="mudo">Nenhum pagamento no período.</p>;
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela--compacta">
        <thead>
          <tr>
            <th scope="col">Quando</th>
            <th scope="col">Ticket</th>
            <th scope="col">Forma</th>
            <th scope="col" className="numero">
              Valor
            </th>
            <th scope="col" className="numero">
              Recebido / troco
            </th>
            <th scope="col">Situação</th>
            <th scope="col">Caixa · por</th>
            <th scope="col">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {itens.map((p) => (
            <tr key={p.id} className={p.status === 'ESTORNADO' ? 'linha-cancelada' : undefined}>
              <td className="sem-quebra">{formatarDataHora(p.registradoEm)}</td>
              <td>
                nº {p.ticketNumero} · <strong>{p.placa}</strong>
                {p.sessaoStatus === 'ABERTA' && <span className="mudo pequeno"> (estacionado)</span>}
              </td>
              <td>
                {p.formaNome}
                {p.parcelas > 1 ? ` ${p.parcelas}×` : ''}
              </td>
              <td className="numero">{formatarCentavos(p.valorCentavos)}</td>
              <td className="numero">
                {p.valorRecebidoCentavos !== null
                  ? `${formatarCentavos(p.valorRecebidoCentavos)} / ${formatarCentavos(p.trocoCentavos)}`
                  : '—'}
              </td>
              <td>
                {p.status === 'CONFIRMADO' ? (
                  <span className="etiqueta etiqueta--ativo">Concluído</span>
                ) : (
                  <span className="etiqueta etiqueta--inativo" title={p.motivoEstorno ?? undefined}>
                    Estornado {p.estornadoEm ? `às ${horaCurta(p.estornadoEm)}` : ''}
                  </span>
                )}
                {p.motivoEstorno && <div className="pequeno mudo">{p.motivoEstorno}</div>}
              </td>
              <td>
                {p.posto ?? '—'} · {p.registradoPor ?? '—'}
              </td>
              <td className="sem-quebra">
                {onDetalhe && (
                  <button type="button" className="botao-texto" onClick={() => onDetalhe(p)}>
                    Detalhes
                  </button>
                )}{' '}
                {onEstornar && p.status === 'CONFIRMADO' && p.sessaoStatus === 'ABERTA' && (
                  <button
                    type="button"
                    className="botao-texto botao-texto--perigo"
                    onClick={() => onEstornar(p)}
                  >
                    Estornar
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
