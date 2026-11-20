import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { TicketPublico } from '@estacionamento/shared';
import type { ErroApi } from '../api';
import type { TicketSalvo } from '../armazenamento';
import { avaliarFrescor, mensagemDeFalha, type Frescor } from '../consulta/regras';
import { useConsultaTicket, type ConsultaTicket } from '../consulta/useConsultaTicket';
import { Placa } from '../componentes/Placa';
import { dataHora, dataHoraCompleta, dinheiro, duracao, haQuanto, hora, horasPorExtenso } from '../formato';

const SELO: Record<TicketPublico['situacao'], { texto: string; classe: string }> = {
  ESTACIONADO: { texto: 'Estacionado', classe: 'selo--ativo' },
  ENCERRADO: { texto: 'Encerrado', classe: 'selo--concluido' },
  CANCELADO: { texto: 'Cancelado', classe: 'selo--cancelado' },
};

/** Situação atual da sessão, em uma frase. */
function situacaoAtual(t: TicketPublico): string {
  if (t.situacao === 'CANCELADO') return 'Ticket cancelado no caixa. Nada a pagar.';
  if (t.situacao === 'ENCERRADO')
    return t.saidaEm ? `Saída registrada ${dataHora(t.saidaEm)}.` : 'Saída registrada.';
  if (t.valorCentavos === 0)
    return 'Veículo no estacionamento, dentro da tolerância (sem cobrança até agora).';
  if (t.pagoCentavos > 0 && t.aPagarCentavos === 0) return 'Veículo no estacionamento. Pago até agora.';
  return 'Veículo no estacionamento. Pagamento no caixa, na saída.';
}

/** O que acontece com este link (política de encerramento do estacionamento). */
function politicaDoLink(t: TicketPublico): string {
  if (t.acessoExpiraEm) return `Este link funciona até ${dataHoraCompleta(t.acessoExpiraEm)}.`;
  const h = t.politicaAcesso.horasAposSaida;
  return h === 0
    ? 'Este link deixa de funcionar quando a saída for registrada.'
    : `Depois da saída, este link continua funcionando por ${horasPorExtenso(h)}.`;
}

/**
 * Um ticket do cliente. Os dados vêm só da API externa, pelo token deste
 * ticket (useConsultaTicket). O que não veio de uma consulta recente é
 * mostrado com o horário em que foi recebido, nunca como "agora".
 */
export function CartaoTicket({ salvo, onEsquecer }: { salvo: TicketSalvo; onEsquecer: () => void }) {
  const c = useConsultaTicket(salvo);
  const { ticket, falha } = c;
  const [agora, setAgora] = useState(() => Date.now());
  const [detalhes, setDetalhes] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  // Relógio da tela: 1 s (tempo correndo, "há X s", contagem para a nova tentativa)
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!ticket) {
    return (
      <section className="cartao ticket ticket--vazio" aria-busy={!falha}>
        {falha ? (
          <ErroTicket falha={falha} consulta={c} agora={agora} onEsquecer={onEsquecer} />
        ) : (
          <p className="mudo">Carregando o seu ticket…</p>
        )}
      </section>
    );
  }

  // Acesso encerrado (prazo após a saída, novo link ou cancelamento): não mostra mais os dados
  const agoraServidor = agora + c.desvioRelogioMs;
  const expirou = ticket.acessoExpiraEm !== null && Date.parse(ticket.acessoExpiraEm) <= agoraServidor;
  if (falha?.tipo === 'NAO_ENCONTRADO' || expirou) {
    return <AcessoEncerrado ticket={ticket} expirou={expirou} onEsquecer={onEsquecer} />;
  }

  const estacionado = ticket.situacao === 'ESTACIONADO';
  const frescor = avaliarFrescor({
    recebidoEm: c.recebidoEm,
    falhando: falha !== null,
    calculadoEm: ticket.calculadoEm,
    sincronizadoEm: ticket.estacionamento.sincronizadoEm ?? ticket.sincronizadoEm,
    agora,
  });
  const aoVivo = frescor !== 'DESATUALIZADO';
  const horaDosDados = hora(ticket.calculadoEm);

  // Tempo: corre só com dados recentes (a partir do horário do servidor, não do relógio do celular).
  // Desatualizado: fica parado no horário do último dado recebido.
  const baseMs =
    (ticket.saidaEm ? Date.parse(ticket.saidaEm) : Date.parse(ticket.calculadoEm)) -
    Date.parse(ticket.entradaEm);
  const tempoMs = estacionado && aoVivo && c.recebidoEm ? baseMs + (agora - c.recebidoEm) : baseMs;
  const proximaFutura =
    ticket.proximaCobranca && Date.parse(ticket.proximaCobranca.em) > agoraServidor
      ? ticket.proximaCobranca
      : null;

  const s = SELO[ticket.situacao];
  return (
    <section
      className={`cartao ticket${aoVivo ? '' : ' ticket--desatualizado'}`}
      aria-label={`Ticket nº ${ticket.numero}`}
    >
      <div className="ticket__cabeca">
        <div>
          <p className="ticket__local">{ticket.estacionamento.nome}</p>
          <p className="mudo pequeno">Ticket nº {ticket.numero}</p>
        </div>
        <span className={`selo ${s.classe}`}>{s.texto}</span>
      </div>

      <EstadoDaAtualizacao consulta={c} ticket={ticket} frescor={frescor} agora={agora} />

      <div className="ticket__placa">
        <Placa placa={ticket.placa} />
        <span className="mudo">
          {ticket.categoria}
          {ticket.vaga ? ` · vaga ${ticket.vaga}` : ''}
        </span>
      </div>
      <p className="ticket__situacao">
        <span className="mudo pequeno">{aoVivo ? 'Situação atual' : `Situação às ${horaDosDados}`}</span>
        {situacaoAtual(ticket)}
      </p>

      <div className="ticket__picote" aria-hidden="true" />

      <dl className="ticket__dados">
        <div>
          <dt>Entrada</dt>
          <dd>{dataHora(ticket.entradaEm)}</dd>
        </div>
        <div>
          <dt>
            Tempo de permanência
            {estacionado && !aoVivo ? ` (às ${horaDosDados})` : ''}
          </dt>
          <dd>
            <span className="relogio" aria-live="off">
              {duracao(tempoMs, estacionado && aoVivo)}
            </span>
          </dd>
        </div>
        {ticket.saidaEm && (
          <div>
            <dt>Saída</dt>
            <dd>{dataHora(ticket.saidaEm)}</dd>
          </div>
        )}
      </dl>

      {ticket.situacao !== 'CANCELADO' && (
        <div
          className={`ticket__valor${
            !estacionado ? ' ticket__valor--final' : aoVivo ? '' : ' ticket__valor--desatualizado'
          }`}
        >
          <span>
            {!estacionado
              ? 'Valor total'
              : aoVivo
                ? 'Valor acumulado até agora'
                : `Valor às ${horaDosDados} (último dado recebido)`}
          </span>
          <strong>{dinheiro(ticket.valorCentavos)}</strong>
          {ticket.pagoCentavos > 0 && (
            <small>
              Já pago {dinheiro(ticket.pagoCentavos)}
              {ticket.aPagarCentavos > 0 ? ` · falta ${dinheiro(ticket.aPagarCentavos)}` : ''}
            </small>
          )}
          {estacionado && !aoVivo ? (
            <small>Pode ter aumentado desde então. O valor certo aparece quando a consulta voltar.</small>
          ) : (
            proximaFutura && (
              <small>
                Passa a {dinheiro(proximaFutura.valorCentavos)} às {hora(proximaFutura.em)}
              </small>
            )
          )}
        </div>
      )}

      {ticket.itens.length > 0 && (
        <details
          className="ticket__detalhes"
          open={detalhes}
          onToggle={(e) => setDetalhes(e.currentTarget.open)}
        >
          <summary>Como o valor foi calculado{aoVivo ? '' : ` (às ${horaDosDados})`}</summary>
          <ul>
            {ticket.itens.map((i) => (
              <li key={i.descricao}>
                <span>
                  {i.quantidade > 1 ? `${i.quantidade} × ` : ''}
                  {i.descricao}
                </span>
                <span>{dinheiro(i.totalCentavos)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <section className="ticket__tarifa" aria-labelledby={`tarifa-${ticket.numero}`}>
        <h2 id={`tarifa-${ticket.numero}`}>Tabela de tarifas do seu ticket</h2>
        <p className="mudo pequeno">
          {ticket.tabelaTarifa.categoria} · {ticket.tabelaTarifa.nome}. Preços gravados na sua entrada: uma
          mudança na tabela depois disso não altera este ticket.
        </p>
        <ul>
          {ticket.tabelaTarifa.linhas.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        <Link to={`/s/${ticket.estacionamento.slug}`} className="botao-texto">
          Ver todos os preços do estacionamento
        </Link>
      </section>

      <p className="atualizacao">
        <span className="mudo">Última atualização: </span>
        <time dateTime={ticket.calculadoEm}>{dataHoraCompleta(ticket.calculadoEm)}</time> (
        {haQuanto(ticket.calculadoEm, agoraServidor)})
      </p>
      <p className="mudo pequeno">{politicaDoLink(ticket)}</p>

      <div className="ticket__acoes">
        <button
          type="button"
          className="botao botao--secundario"
          onClick={c.atualizar}
          disabled={c.consultando}
        >
          {c.consultando ? 'Atualizando…' : 'Atualizar'}
        </button>
        <Esquecer confirmar={confirmar} setConfirmar={setConfirmar} onEsquecer={onEsquecer} />
      </div>
    </section>
  );
}

/** "em 12 s" / "em 1 min". */
function contagem(ms: number): string {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `em ${s} s` : `em ${Math.round(s / 60)} min`;
}

/**
 * Faixa do topo do cartão: ao vivo, atualizando, estacionamento sem enviar
 * dados, ou indisponível (com a hora dos dados mostrados e a próxima tentativa).
 */
function EstadoDaAtualizacao({
  consulta: c,
  ticket,
  frescor,
  agora,
}: {
  consulta: ConsultaTicket;
  ticket: TicketPublico;
  frescor: Frescor;
  agora: number;
}) {
  const agoraServidor = agora + c.desvioRelogioMs;
  const quando = `${dataHoraCompleta(ticket.calculadoEm)} (${idade(agoraServidor - Date.parse(ticket.calculadoEm))})`;
  const ativo = ticket.situacao === 'ESTACIONADO';

  if (frescor === 'AO_VIVO') {
    if (!ativo) return null;
    return (
      <p className="estado estado--ao-vivo" role="status">
        <span className="estado__ponto" aria-hidden="true" /> Atualizando automaticamente · última consulta{' '}
        {c.recebidoEm ? segundosAtras(agora - c.recebidoEm) : 'agora'}
      </p>
    );
  }
  if (frescor === 'SEM_SINCRONIA') {
    const sinc = ticket.estacionamento.sincronizadoEm ?? ticket.sincronizadoEm;
    return (
      <div className="estado estado--aviso" role="status">
        <p>
          <b>O estacionamento não envia dados desde {dataHoraCompleta(sinc)}.</b>
        </p>
        <p>
          O tempo e o valor seguem o relógio, mas uma saída ou um pagamento feito depois disso pode ainda não
          aparecer. O caixa confirma o valor na saída.
        </p>
      </div>
    );
  }
  // DESATUALIZADO: ainda sem a primeira resposta, ou falha
  if (!c.falha) {
    return (
      <p className="estado estado--aviso" role="status">
        Buscando dados atualizados… Por enquanto, mostrando os de {quando}.
      </p>
    );
  }
  if (!ativo) {
    // Encerrado/cancelado: os dados da saída não mudam mais; só não foi possível confirmar agora
    return (
      <p className="estado estado--aviso" role="status">
        {mensagemDeFalha(c.falha.tipo)} Mostrando os dados de {quando}; depois da saída eles não mudam mais.
      </p>
    );
  }
  const tentativa = c.consultando
    ? 'Tentando de novo…'
    : c.falha.tipo === 'SEM_CONEXAO'
      ? 'A consulta volta sozinha quando a internet voltar.'
      : c.proximaEm
        ? `Nova tentativa automática ${contagem(c.proximaEm - agora)}.`
        : '';
  return (
    <div className="estado estado--falha" role="alert">
      <p>
        <b>{mensagemDeFalha(c.falha.tipo)}</b> {tentativa}
      </p>
      <p>
        Estes dados <b>não são em tempo real</b>: são de {quando}.
      </p>
      <button type="button" className="botao-texto" onClick={c.atualizar} disabled={c.consultando}>
        Tentar agora
      </button>
    </div>
  );
}

/** Idade exata dos dados ("há 12 s"), sem arredondar para "agora". */
function idade(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `há ${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `há ${m} min` : `há ${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

function segundosAtras(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return s < 5 ? 'agora' : s < 60 ? `há ${s} s` : `há ${Math.floor(s / 60)} min`;
}

function Esquecer({
  confirmar,
  setConfirmar,
  onEsquecer,
}: {
  confirmar: boolean;
  setConfirmar: (v: boolean) => void;
  onEsquecer: () => void;
}) {
  return confirmar ? (
    <span className="confirmar">
      Tirar este ticket do celular?{' '}
      <button type="button" className="botao-texto botao-texto--perigo" onClick={onEsquecer}>
        Sim, esquecer
      </button>{' '}
      <button type="button" className="botao-texto" onClick={() => setConfirmar(false)}>
        Não
      </button>
    </span>
  ) : (
    <button type="button" className="botao-texto" onClick={() => setConfirmar(true)}>
      Esquecer este ticket
    </button>
  );
}

/** Depois do encerramento o app não mostra mais placa nem valores (só avisa). */
function AcessoEncerrado({
  ticket,
  expirou,
  onEsquecer,
}: {
  ticket: TicketPublico;
  expirou: boolean;
  onEsquecer: () => void;
}) {
  const h = ticket.politicaAcesso.horasAposSaida;
  return (
    <section className="cartao ticket ticket--encerrado" aria-label={`Ticket nº ${ticket.numero}`}>
      <div className="ticket__cabeca">
        <div>
          <p className="ticket__local">{ticket.estacionamento.nome}</p>
          <p className="mudo pequeno">Ticket nº {ticket.numero}</p>
        </div>
        <span className="selo selo--cancelado">Acesso encerrado</span>
      </div>
      <p>
        {expirou && ticket.acessoExpiraEm
          ? `O acesso a este ticket terminou em ${dataHoraCompleta(ticket.acessoExpiraEm)}. ${
              h === 0
                ? 'Neste estacionamento, o link deixa de funcionar na saída.'
                : `Neste estacionamento, o link funciona por ${horasPorExtenso(h)} depois da saída.`
            }`
          : 'Este link não funciona mais: ele foi trocado por um novo no caixa, o ticket foi cancelado ou o prazo depois da saída terminou.'}
      </p>
      <p className="mudo pequeno">Dúvidas sobre o valor pago? Fale com o caixa do estacionamento.</p>
      <button type="button" className="botao botao--secundario" onClick={onEsquecer}>
        Tirar este ticket do celular
      </button>
    </section>
  );
}

function ErroTicket({
  falha,
  consulta: c,
  agora,
  onEsquecer,
}: {
  falha: ErroApi;
  consulta: ConsultaTicket;
  agora: number;
  onEsquecer: () => void;
}) {
  if (falha.tipo === 'NAO_ENCONTRADO') {
    return (
      <>
        <p className="alerta">
          Não encontramos este ticket. Confira o link ou peça um novo QR Code no caixa. Depois da saída, o
          link funciona só pelo prazo definido pelo estacionamento.
        </p>
        <button type="button" className="botao-texto" onClick={onEsquecer}>
          Tirar este ticket do celular
        </button>
      </>
    );
  }
  // Primeiro acesso sem conseguir falar com a API: nada para mostrar ainda
  return (
    <div className="estado estado--falha" role="alert">
      <p>
        <b>{mensagemDeFalha(falha.tipo)}</b> Não foi possível carregar o seu ticket.
      </p>
      <p>
        {c.consultando
          ? 'Tentando de novo…'
          : falha.tipo === 'SEM_CONEXAO'
            ? 'Ele aparece sozinho quando a internet voltar.'
            : c.proximaEm
              ? `Nova tentativa automática ${contagem(c.proximaEm - agora)}.`
              : ''}
      </p>
      <button type="button" className="botao-texto" onClick={c.atualizar} disabled={c.consultando}>
        Tentar agora
      </button>
    </div>
  );
}
