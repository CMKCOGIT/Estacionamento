import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  formatarCentavos,
  formatarPlaca,
  type Alerta,
  type DashboardResposta,
  type NivelAlerta,
  type SituacaoSync,
} from '@estacionamento/shared';
import { useAuth } from '../auth/contexto';
import { GraficoColunas } from '../components/graficos/GraficoColunas';
import { GraficoFaturamento } from '../components/graficos/GraficoFaturamento';
import { GraficoOcupacao } from '../components/graficos/GraficoOcupacao';
import { useAtualizacaoAutomatica } from '../hooks/useAtualizacaoAutomatica';
import { api } from '../services/api';
import { formatarDataHora } from '../services/rotulos';

const INTERVALO_MS = 15_000;

function duracao(min: number | null): string {
  if (min === null) return '—';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const hora = (d: Date) => d.toLocaleTimeString('pt-BR');
const porcento = (parte: number, total: number) => (total > 0 ? Math.round((parte / total) * 100) : 0);

/** Atualiza o "há X s" sem buscar dados de novo. */
function useAgora(intervaloMs: number) {
  const [agora, setAgora] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(t);
  }, [intervaloMs]);
  return agora;
}

export function Dashboard() {
  const { usuario } = useAuth();
  const carregar = useCallback(() => api<DashboardResposta>('/dashboard'), []);
  const { dados, erro, atualizando, atualizadoEm, atualizarAgora } = useAtualizacaoAutomatica(
    carregar,
    INTERVALO_MS,
  );
  const agora = useAgora(5_000);

  if (!dados) {
    return erro ? (
      <p className="alerta alerta--erro">Não foi possível carregar o painel: {erro.message}</p>
    ) : (
      <p className="mudo">Carregando indicadores…</p>
    );
  }

  const { operacao, financeiro, sincronizacao, alertas } = dados;
  const segundos = atualizadoEm ? Math.round((agora - atualizadoEm.getTime()) / 1000) : 0;

  return (
    <div className={`painel${atualizando ? ' painel--atualizando' : ''}`}>
      <header className="cabecalho">
        <div>
          <h1>Painel do estacionamento</h1>
          <p className="mudo">
            Olá, {usuario?.nome}.{' '}
            {atualizadoEm && (
              <>
                Atualizado às {hora(atualizadoEm)}
                {segundos >= 5 && ` (há ${segundos} s)`} · atualiza sozinho a cada 15 s.
              </>
            )}
          </p>
        </div>
        <button
          type="button"
          className="botao botao--secundario"
          onClick={atualizarAgora}
          disabled={atualizando}
        >
          {atualizando ? 'Atualizando…' : 'Atualizar agora'}
        </button>
      </header>

      {erro && (
        <p className="alerta alerta--erro" role="alert">
          Não foi possível atualizar ({erro.message}). Exibindo os dados de{' '}
          {atualizadoEm ? hora(atualizadoEm) : '—'}.
        </p>
      )}

      {alertas.length > 0 && <Alertas alertas={alertas} />}

      <section className="indicadores" aria-label="Indicadores">
        {operacao && (
          <>
            <Indicador rotulo="Total de vagas" valor={operacao.vagas.total} />
            <Indicador rotulo="Vagas disponíveis" valor={operacao.vagas.disponiveis} destaque />
            <Indicador
              rotulo="Vagas ocupadas"
              valor={operacao.vagas.ocupadas}
              extra={`${porcento(operacao.vagas.ocupadas, operacao.vagas.total - operacao.vagas.bloqueadas)}% das vagas em uso`}
            />
            <Indicador rotulo="Vagas bloqueadas" valor={operacao.vagas.bloqueadas} extra="em manutenção" />
            <Indicador rotulo="Veículos estacionados" valor={operacao.veiculosEstacionados} />
            <Indicador rotulo="Entradas hoje" valor={operacao.hoje.entradas} />
            <Indicador rotulo="Saídas hoje" valor={operacao.hoje.saidas} />
          </>
        )}
        {financeiro && (
          <>
            <Indicador
              rotulo="Faturamento hoje"
              valor={formatarCentavos(financeiro.faturamentoHojeCentavos)}
              extra={`Ontem: ${formatarCentavos(financeiro.faturamentoOntemCentavos)}`}
            />
            <Indicador
              rotulo="Recebido no caixa hoje"
              valor={formatarCentavos(financeiro.caixa.recebidoNoCaixaCentavos)}
              extra={`${financeiro.caixa.recebimentos} pagamento${financeiro.caixa.recebimentos === 1 ? '' : 's'} no guichê`}
            />
            <Indicador
              rotulo="Pagamentos pendentes"
              valor={financeiro.pendentes.quantidade}
              extra={
                financeiro.pendentes.quantidade
                  ? `${formatarCentavos(financeiro.pendentes.valorEstimadoCentavos)} estimados até agora`
                  : 'Nenhum veículo com valor em aberto'
              }
            />
          </>
        )}
      </section>

      {operacao && (
        <section className="cartao">
          <h2>Movimentação por horário (hoje)</h2>
          <p className="mudo legenda-grafico">Entradas e saídas registradas em cada hora do dia.</p>
          <GraficoColunas
            formato="numero"
            descricao="Entradas e saídas por hora hoje"
            pontos={operacao.movimentoPorHora
              .filter((h) => h.hora <= new Date().getHours())
              .map((h) => ({
                chave: String(h.hora),
                eixo: [`${String(h.hora).padStart(2, '0')}h`],
                valorCentavos: h.entradas + h.saidas,
                titulo: `${String(h.hora).padStart(2, '0')}:00 – ${String(h.hora).padStart(2, '0')}:59`,
                linhas: [`${h.entradas} entrada(s)`, `${h.saidas} saída(s)`],
              }))}
          />
        </section>
      )}

      {operacao && (
        <div className="grade-painel">
          <section className="cartao cartao--largo">
            <h2>Ocupação nas últimas 24 horas</h2>
            <p className="mudo legenda-grafico">
              Veículos estacionados a cada hora. A linha cinza é a capacidade atual.
            </p>
            <GraficoOcupacao
              pontos={operacao.ocupacao24h}
              capacidade={operacao.vagas.total - operacao.vagas.bloqueadas}
            />
          </section>

          <section className="cartao">
            <h2>Ocupação por categoria</h2>
            {operacao.porCategoria.length === 0 && <p className="mudo">Nenhuma vaga cadastrada.</p>}
            <ul className="medidores">
              {operacao.porCategoria.map((c) => {
                const uteis = c.total - c.bloqueadas;
                const taxa = uteis > 0 ? c.ocupadas / uteis : 0;
                const nivel =
                  c.disponiveis === 0 && uteis > 0 ? 'critico' : taxa >= 0.8 ? 'atencao' : 'normal';
                return (
                  <li key={c.categoriaId}>
                    <div className="medidor__titulo">
                      <strong>{c.nome}</strong>
                      <span>
                        {c.ocupadas} de {uteis} · {Math.round(taxa * 100)}%
                      </span>
                    </div>
                    <div
                      className={`medidor medidor--${nivel}`}
                      role="meter"
                      aria-valuemin={0}
                      aria-valuemax={uteis}
                      aria-valuenow={c.ocupadas}
                      aria-label={`${c.nome}: ${c.ocupadas} de ${uteis} vagas ocupadas`}
                    >
                      <span style={{ width: `${Math.min(taxa, 1) * 100}%` }} />
                    </div>
                    <div className="mudo medidor__detalhe">
                      {c.disponiveis} livre{c.disponiveis === 1 ? '' : 's'}
                      {c.bloqueadas > 0 && ` · ${c.bloqueadas} em manutenção`}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      )}

      {financeiro && (
        <div className="grade-painel">
          <section className="cartao cartao--largo">
            <h2>Faturamento dos últimos 7 dias</h2>
            <p className="mudo legenda-grafico">Pagamentos confirmados por dia (estornos não entram).</p>
            <GraficoFaturamento
              dias={financeiro.faturamento7dias}
              nomesFormas={Object.fromEntries(financeiro.hojePorForma.map((f) => [f.forma, f.nome]))}
            />
          </section>

          <section className="cartao">
            <h2>Hoje por forma de pagamento</h2>
            <table className="tabela tabela--compacta">
              <tbody>
                {financeiro.hojePorForma.map((f) => (
                  <tr key={f.forma}>
                    <td>{f.nome}</td>
                    <td className="numero mudo">{f.quantidade}×</td>
                    <td className="numero">{formatarCentavos(f.centavos)}</td>
                  </tr>
                ))}
                <tr className="tabela__total">
                  <td>Total</td>
                  <td />
                  <td className="numero">{formatarCentavos(financeiro.faturamentoHojeCentavos)}</td>
                </tr>
              </tbody>
            </table>
            {financeiro.estornosHoje.quantidade > 0 && (
              <p className="mudo">
                Estornos hoje: {financeiro.estornosHoje.quantidade} (
                {formatarCentavos(financeiro.estornosHoje.centavos)})
              </p>
            )}
            <h3>Situação do caixa</h3>
            <dl className="lista-definicoes">
              <dt>Caixas</dt>
              <dd>
                {financeiro.caixa.abertos ? `${financeiro.caixa.abertos} aberto(s)` : 'Fechado'}
                {financeiro.caixa.fechadosHoje > 0 && ` · ${financeiro.caixa.fechadosHoje} fechado(s) hoje`}
              </dd>
              <dt>Troco inicial</dt>
              <dd>{formatarCentavos(financeiro.caixa.saldoInicialCentavos)}</dd>
              <dt>Dinheiro em caixa</dt>
              <dd>
                <strong>{formatarCentavos(financeiro.caixa.dinheiroEmCaixaCentavos)}</strong>
              </dd>
            </dl>
            <p className="mudo pequeno">
              Faturamento = pagamentos − estornos. Recebido no caixa = pagamentos no guichê hoje (todas as
              formas). Dinheiro em caixa = o que deve estar nas gavetas abertas agora.
            </p>
            <h3>Caixas abertos</h3>
            {financeiro.caixasAbertos.length === 0 ? (
              <p className="mudo">Nenhum caixa aberto.</p>
            ) : (
              <ul className="lista-simples">
                {financeiro.caixasAbertos.map((c) => (
                  <li key={c.id}>
                    <strong>{c.operador}</strong> · {c.posto}
                    <span className="mudo"> desde {formatarDataHora(c.abertoEm)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <div className="grade-painel">
        {operacao && (
          <section className="cartao cartao--largo">
            <h2>Últimas entradas e saídas</h2>
            {operacao.ultimosMovimentos.length === 0 ? (
              <p className="mudo">Nenhum movimento registrado ainda.</p>
            ) : (
              <div className="tabela-rolagem">
                <table className="tabela">
                  <thead>
                    <tr>
                      <th>Horário</th>
                      <th>Movimento</th>
                      <th>Placa</th>
                      <th>Vaga</th>
                      <th>Permanência</th>
                      <th className="numero">Valor</th>
                      <th>Operador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operacao.ultimosMovimentos.map((m) => (
                      <tr key={`${m.tipo}-${m.sessaoId}`}>
                        <td className="sem-quebra">{formatarDataHora(m.em)}</td>
                        <td>
                          <span className={`etiqueta etiqueta--mov-${m.tipo.toLowerCase()}`}>
                            {m.tipo === 'ENTRADA'
                              ? '↓ Entrada'
                              : m.tipo === 'SAIDA'
                                ? '↑ Saída'
                                : '✕ Cancelada'}
                          </span>
                        </td>
                        <td className="sem-quebra">
                          <code>{formatarPlaca(m.placa)}</code>
                          <span className="mudo"> · {m.categoria}</span>
                        </td>
                        <td className="sem-quebra">{m.vaga ?? '—'}</td>
                        <td className="sem-quebra">{duracao(m.permanenciaMin)}</td>
                        <td className="numero">
                          {m.valorCentavos === null ? '—' : formatarCentavos(m.valorCentavos)}
                        </td>
                        <td>{m.operador ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        <div className="coluna-painel">
          {operacao && (
            <section className="cartao">
              <h2>Resumo de hoje</h2>
              <dl className="resumo">
                <div>
                  <dt>Entradas</dt>
                  <dd>{operacao.hoje.entradas}</dd>
                </div>
                <div>
                  <dt>Saídas</dt>
                  <dd>{operacao.hoje.saidas}</dd>
                </div>
                <div>
                  <dt>Cancelamentos</dt>
                  <dd>{operacao.hoje.cancelamentos}</dd>
                </div>
                <div>
                  <dt>Permanência média</dt>
                  <dd>{duracao(operacao.hoje.permanenciaMediaMin)}</dd>
                </div>
              </dl>
            </section>
          )}
          {sincronizacao && <CartaoSincronizacao s={sincronizacao} />}
        </div>
      </div>

      {!operacao && !financeiro && (
        <section className="cartao">
          <p className="mudo">
            Seu perfil ainda não inclui indicadores do estacionamento. Peça ao administrador para liberar as
            funcionalidades de que você precisa.
          </p>
        </section>
      )}
    </div>
  );
}

function Indicador({
  rotulo,
  valor,
  extra,
  destaque,
}: {
  rotulo: string;
  valor: number | string;
  extra?: string;
  destaque?: boolean;
}) {
  return (
    <article className={`indicador-cartao${destaque ? ' indicador-cartao--destaque' : ''}`}>
      <span className="indicador-cartao__rotulo">{rotulo}</span>
      <span className="indicador-cartao__valor">
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
      </span>
      {extra && <span className="indicador-cartao__extra">{extra}</span>}
    </article>
  );
}

const NIVEIS: Record<NivelAlerta, { rotulo: string; icone: string }> = {
  critico: { rotulo: 'Crítico', icone: '!' },
  serio: { rotulo: 'Importante', icone: '!' },
  atencao: { rotulo: 'Atenção', icone: '!' },
  info: { rotulo: 'Informação', icone: 'i' },
};

function Alertas({ alertas }: { alertas: Alerta[] }) {
  return (
    <section className="alertas" aria-label="Alertas operacionais">
      {alertas.map((a) => (
        <article key={a.codigo} className={`alerta-op alerta-op--${a.nivel}`}>
          <span className="alerta-op__icone" aria-hidden="true">
            {NIVEIS[a.nivel].icone}
          </span>
          <div>
            <strong>{a.titulo}</strong>
            <span className="alerta-op__nivel"> · {NIVEIS[a.nivel].rotulo}</span>
            <div className="alerta-op__detalhe">{a.detalhe}</div>
          </div>
        </article>
      ))}
    </section>
  );
}

const SITUACOES: Record<SituacaoSync, { titulo: string; nivel: NivelAlerta | 'bom'; texto: string }> = {
  NAO_CONFIGURADA: {
    titulo: 'Ainda não configurada',
    nivel: 'info',
    texto:
      'A conexão com o servidor externo será ativada em uma próxima etapa. Tudo continua guardado aqui e será enviado quando ela estiver ativa.',
  },
  NUNCA_SINCRONIZOU: {
    titulo: 'Aguardando o primeiro envio',
    nivel: 'atencao',
    texto: 'A conexão está configurada, mas nenhum envio foi confirmado ainda.',
  },
  EM_DIA: {
    titulo: 'Em dia',
    nivel: 'bom',
    texto: 'Os dados para os clientes estão atualizados no servidor externo.',
  },
  ATRASADA: {
    titulo: 'Atrasada',
    nivel: 'atencao',
    texto: 'Há dados aguardando envio. Verifique a internet do estacionamento.',
  },
  COM_ERROS: {
    titulo: 'Com erros',
    nivel: 'critico',
    texto: 'O servidor externo recusou alguns dados. Veja os detalhes abaixo.',
  },
};

function CartaoSincronizacao({ s }: { s: NonNullable<DashboardResposta['sincronizacao']> }) {
  const { temPermissao } = useAuth();
  const info = SITUACOES[s.situacao];
  return (
    <section className="cartao">
      <h2>Sincronização com o servidor externo</h2>
      <p className={`situacao situacao--${info.nivel}`}>
        <span className="situacao__ponto" aria-hidden="true" />
        {info.titulo}
      </p>
      <p className="mudo">{info.texto}</p>
      <dl className="resumo resumo--linhas">
        <div>
          <dt>Aguardando envio</dt>
          <dd>{s.pendentes.toLocaleString('pt-BR')}</dd>
        </div>
        <div>
          <dt>Recusados</dt>
          <dd>{s.rejeitados}</dd>
        </div>
        <div>
          <dt>Último envio confirmado</dt>
          <dd>{formatarDataHora(s.ultimoSucessoEm)}</dd>
        </div>
      </dl>
      {s.ultimoErro && <p className="alerta alerta--erro">Último erro: {s.ultimoErro}</p>}
      <p className="mudo pequeno">
        Servidor local e banco de dados funcionando.{' '}
        {temPermissao('auditoria.ver') && <Link to="/atividades">Ver histórico</Link>}
      </p>
    </section>
  );
}
