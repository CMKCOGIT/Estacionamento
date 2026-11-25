import { useCallback, useState } from 'react';
import { formatarCentavos, type CaixaResumo, type FormaPagamento } from '@estacionamento/shared';
import { useAuth } from '../../auth/contexto';
import { useCarregar } from '../../hooks/useCarregar';
import { ErroDaApi } from '../../services/api';
import { financeiroApi } from '../../services/financeiro';
import { formatarDataHora } from '../../services/rotulos';
import { BotoesExportar } from '../BotoesExportar';
import { Dialogo } from '../Dialogo';
import { reais } from '../exportar';
import { DialogoCaixa } from './DialogoCaixa';
import { hojeLocal } from './rotulos';

const diasAtras = (n: number) => {
  const d = new Date(`${hojeLocal()}T12:00:00`);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Caixas anteriores: fechamentos preservados como foram feitos. Correção é
 * uma nova movimentação (AJUSTE) com motivo, de quem supervisiona.
 */
export function CaixasAnteriores({
  formas,
  avisar,
}: {
  formas: FormaPagamento[];
  avisar: (tipo: 'ok' | 'erro', texto: string) => void;
}) {
  const { temPermissao } = useAuth();
  const supervisiona = temPermissao('caixa.supervisionar');
  const [de, setDe] = useState(diasAtras(30));
  const [ate, setAte] = useState(hojeLocal());
  const carregar = useCallback(() => financeiroApi.caixas({ de, ate }), [de, ate]);
  const { dados, erro, recarregar } = useCarregar(carregar);
  const [ver, setVer] = useState<string | null>(null);
  const [corrigir, setCorrigir] = useState<CaixaResumo | null>(null);
  const itens = (dados?.itens ?? []).filter((c) => c.status === 'FECHADO');

  return (
    <section className="cartao">
      <div className="cartao__topo">
        <h2>Caixas fechados</h2>
        <BotoesExportar
          nome={`caixas-${de}-a-${ate}`}
          desabilitado={!itens.length}
          abas={() => [
            {
              nome: 'Caixas',
              cabecalho: [
                'Guichê',
                'Operador',
                'Aberto',
                'Fechado',
                'Troco inicial (R$)',
                'Recebido (R$)',
                'Esperado (R$)',
                'Contado (R$)',
                'Diferença (R$)',
                'Correções (R$)',
                'Diferença corrigida (R$)',
                'Observação',
              ],
              linhas: itens.map((c) => [
                c.posto,
                c.operador,
                formatarDataHora(c.abertoEm),
                c.fechadoEm ? formatarDataHora(c.fechadoEm) : null,
                reais(c.saldoInicialCentavos),
                reais(c.recebidoCentavos),
                reais(c.dinheiroEsperadoCentavos),
                reais(c.saldoContadoCentavos),
                reais(c.diferencaCentavos),
                reais(c.ajustesCentavos),
                reais(c.diferencaCorrigidaCentavos),
                c.observacao,
              ]),
            },
          ]}
        />
      </div>
      <div className="filtros nao-imprimir">
        <label className="campo">
          <span>De</span>
          <input type="date" value={de} max={ate} onChange={(e) => e.target.value && setDe(e.target.value)} />
        </label>
        <label className="campo">
          <span>Até</span>
          <input
            type="date"
            value={ate}
            min={de}
            onChange={(e) => e.target.value && setAte(e.target.value)}
          />
        </label>
      </div>
      {erro && <p className="alerta alerta--erro">{erro.message}</p>}
      {!dados && !erro && <p className="mudo">Carregando…</p>}
      {dados && itens.length === 0 && <p className="mudo">Nenhum caixa fechado neste período.</p>}
      {itens.length > 0 && (
        <div className="tabela-rolagem">
          <table className="tabela tabela--compacta">
            <thead>
              <tr>
                <th scope="col">Caixa</th>
                <th scope="col">Fechado</th>
                <th scope="col" className="numero">
                  Esperado
                </th>
                <th scope="col" className="numero">
                  Contado
                </th>
                <th scope="col" className="numero">
                  Diferença
                </th>
                <th scope="col" className="numero">
                  Corrigida
                </th>
                <th scope="col">
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itens.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.posto} · {c.operador}
                    <div className="pequeno mudo">aberto {formatarDataHora(c.abertoEm)}</div>
                  </td>
                  <td className="sem-quebra">{c.fechadoEm ? formatarDataHora(c.fechadoEm) : '—'}</td>
                  <td className="numero">{formatarCentavos(c.dinheiroEsperadoCentavos ?? 0)}</td>
                  <td className="numero">
                    {c.saldoContadoCentavos === null ? '—' : formatarCentavos(c.saldoContadoCentavos)}
                  </td>
                  <td className={`numero ${c.diferencaCentavos ? 'erro' : ''}`}>
                    {c.diferencaCentavos === null ? '—' : formatarCentavos(c.diferencaCentavos)}
                  </td>
                  <td className={`numero ${c.diferencaCorrigidaCentavos ? 'erro' : ''}`}>
                    {c.quantidadeAjustes ? formatarCentavos(c.diferencaCorrigidaCentavos ?? 0) : '—'}
                  </td>
                  <td className="sem-quebra">
                    <button type="button" className="botao-texto" onClick={() => setVer(c.id)}>
                      Ver
                    </button>
                    {supervisiona && (
                      <button type="button" className="botao-texto" onClick={() => setCorrigir(c)}>
                        Corrigir
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mudo pequeno">
        Um caixa fechado não muda. Se algo foi contado ou lançado errado, registre uma correção com o motivo:
        ela fica à parte, com quem registrou e quando, e a diferença corrigida aparece ao lado da original.
      </p>
      {ver && (
        <DialogoCaixa caixaId={ver} podeFechar={false} onFechar={() => setVer(null)} onMudou={recarregar} />
      )}
      <DialogoCorrecao
        caixa={corrigir}
        formas={formas}
        onFechar={() => setCorrigir(null)}
        onCorrigido={() => {
          setCorrigir(null);
          avisar('ok', 'Correção registrada. O fechamento original foi preservado.');
          recarregar();
        }}
      />
    </section>
  );
}

function DialogoCorrecao({
  caixa,
  formas,
  onFechar,
  onCorrigido,
}: {
  caixa: CaixaResumo | null;
  formas: FormaPagamento[];
  onFechar: () => void;
  onCorrigido: () => void;
}) {
  const [direcao, setDirecao] = useState<'ENTRADA' | 'SAIDA'>('ENTRADA');
  const [valor, setValor] = useState('');
  const [forma, setForma] = useState('DINHEIRO');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [anterior, setAnterior] = useState(caixa);
  if (anterior !== caixa) {
    setAnterior(caixa);
    setDirecao('ENTRADA');
    setValor('');
    setForma('DINHEIRO');
    setMotivo('');
    setErro(null);
  }
  const centavos = Math.round(Number(valor.replace(',', '.')) * 100);
  return (
    <Dialogo
      aberto={!!caixa}
      titulo="Corrigir caixa fechado"
      textoConfirmar={enviando ? 'Registrando…' : 'Registrar correção'}
      enviando={enviando}
      erro={erro}
      onFechar={() => !enviando && onFechar()}
      onConfirmar={() => {
        if (!caixa) return;
        if (!Number.isFinite(centavos) || centavos <= 0) return setErro('Informe um valor maior que zero.');
        if (motivo.trim().length < 5) return setErro('Explique a correção (mínimo 5 caracteres).');
        setEnviando(true);
        setErro(null);
        financeiroApi
          .corrigirCaixa(caixa.id, {
            direcao,
            valorCentavos: centavos,
            formaCodigo: forma,
            motivo: motivo.trim(),
          })
          .then(onCorrigido)
          .catch((e: unknown) =>
            setErro(e instanceof ErroDaApi || e instanceof Error ? e.message : 'Falhou.'),
          )
          .finally(() => setEnviando(false));
      }}
    >
      {caixa && (
        <>
          <p>
            {caixa.posto} · {caixa.operador}, fechado em{' '}
            {caixa.fechadoEm ? formatarDataHora(caixa.fechadoEm) : '—'}. Diferença no fechamento:{' '}
            <strong>
              {caixa.diferencaCentavos === null ? '—' : formatarCentavos(caixa.diferencaCentavos)}
            </strong>
            .
          </p>
          <div className="grade-config">
            <label className="campo">
              <span>Tipo</span>
              <select value={direcao} onChange={(e) => setDirecao(e.target.value as 'ENTRADA' | 'SAIDA')}>
                <option value="ENTRADA">Entrada (dinheiro achado, lançamento a mais)</option>
                <option value="SAIDA">Saída (lançamento a menos, retirada não registrada)</option>
              </select>
            </label>
            <label className="campo">
              <span>Valor (R$)</span>
              <input
                inputMode="decimal"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
                placeholder="0,00"
              />
            </label>
            <label className="campo">
              <span>Forma</span>
              <select value={forma} onChange={(e) => setForma(e.target.value)}>
                {formas.map((f) => (
                  <option key={f.codigo} value={f.codigo}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="campo">
            <span>Motivo (fica no histórico)</span>
            <textarea value={motivo} maxLength={255} onChange={(e) => setMotivo(e.target.value)} rows={3} />
          </label>
        </>
      )}
    </Dialogo>
  );
}
