import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { TicketPublico } from '@estacionamento/shared';
import { api, ErroApi } from '../api';
import { apagarDadosPessoais, atualizarUltimo, esquecer, type TicketSalvo } from '../armazenamento';
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
 * Um ticket do cliente. Busca na API só pelo token deste ticket; sem
 * internet mostra a última resposta guardada, com o horário dela.
 */
export function CartaoTicket({ salvo, onEsquecer }: { salvo: TicketSalvo; onEsquecer: () => void }) {
  const [ticket, setTicket] = useState<TicketPublico | null>(salvo.ultimo);
  const [falha, setFalha] = useState<ErroApi | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [detalhes, setDetalhes] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const jaFuncionou = salvo.ultimo !== null;
  const buscar = useCallback(
    () =>
      api.ticket(salvo.token).then(
        (t) => {
          setTicket(t);
          setFalha(null);
          setAgora(Date.now());
          atualizarUltimo(salvo.token, t);
        },
        (e: unknown) => {
          const erro = e instanceof ErroApi ? e : new ErroApi('INDISPONIVEL', 'Não foi possível atualizar.');
          if (erro.tipo === 'NAO_ENCONTRADO') {
            // Link que nunca funcionou (digitado/alterado): não fica guardado; os que já funcionaram perdem os dados pessoais
            if (jaFuncionou) apagarDadosPessoais(salvo.token);
            else esquecer(salvo.token);
          }
          setFalha(erro);
        },
      ),
    [salvo.token, jaFuncionou],
  );

  // Busca ao abrir, ao voltar para o app e quando a internet volta
  useEffect(() => {
    void buscar();
    const visivel = () => document.visibilityState === 'visible' && void buscar();
    document.addEventListener('visibilitychange', visivel);
    window.addEventListener('online', buscar);
    return () => {
      document.removeEventListener('visibilitychange', visivel);
      window.removeEventListener('online', buscar);
    };
  }, [buscar]);

  // Estacionado: atualiza o valor quando ele sobe (ou a cada minuto) e o relógio a cada segundo
  const estacionado = ticket?.situacao === 'ESTACIONADO';
  const proxima = ticket?.proximaCobranca?.em ?? null;
  const calculadoEm = ticket?.calculadoEm ?? null;
  useEffect(() => {
    if (!estacionado) return;
    const ate = proxima ? Date.parse(proxima) - Date.now() + 1000 : 60_000;
    const t = setTimeout(() => void buscar(), Math.min(Math.max(ate, 5000), 60_000));
    return () => clearTimeout(t);
  }, [estacionado, proxima, buscar, calculadoEm]);
  useEffect(() => {
    const t = setInterval(() => setAgora(Date.now()), estacionado ? 1000 : 30_000);
    return () => clearInterval(t);
  }, [estacionado]);

  if (!ticket) {
    return (
      <section className="cartao ticket ticket--vazio" aria-busy={!falha}>
        {falha ? (
          <ErroTicket falha={falha} onEsquecer={onEsquecer} />
        ) : (
          <p className="mudo">Carregando o seu ticket…</p>
        )}
      </section>
    );
  }

  // Acesso encerrado (prazo após a saída, novo link ou cancelamento): não mostra mais os dados
  const encerrado =
    falha?.tipo === 'NAO_ENCONTRADO' ||
    (ticket.acessoExpiraEm !== null && Date.parse(ticket.acessoExpiraEm) <= agora);
  if (encerrado) {
    return (
      <AcessoEncerrado
        ticket={ticket}
        expirou={ticket.acessoExpiraEm !== null && Date.parse(ticket.acessoExpiraEm) <= agora}
        onEsquecer={onEsquecer}
      />
    );
  }

  const s = SELO[ticket.situacao];
  // Relógio: a partir do tempo calculado pelo servidor (não depende do relógio do celular estar certo)
  const decorridoMs = estacionado ? Math.max(0, agora - Date.parse(ticket.calculadoEm)) : 0;
  const tempoMs = ticket.saidaEm
    ? Date.parse(ticket.saidaEm) - Date.parse(ticket.entradaEm)
    : Date.parse(ticket.calculadoEm) - Date.parse(ticket.entradaEm) + decorridoMs;
  return (
    <section className="cartao ticket" aria-label={`Ticket nº ${ticket.numero}`}>
      <div className="ticket__cabeca">
        <div>
          <p className="ticket__local">{ticket.estacionamento.nome}</p>
          <p className="mudo pequeno">Ticket nº {ticket.numero}</p>
        </div>
        <span className={`selo ${s.classe}`}>{s.texto}</span>
      </div>
      <div className="ticket__placa">
        <Placa placa={ticket.placa} />
        <span className="mudo">
          {ticket.categoria}
          {ticket.vaga ? ` · vaga ${ticket.vaga}` : ''}
        </span>
      </div>
      <p className="ticket__situacao">
        <span className="mudo pequeno">Situação atual</span>
        {situacaoAtual(ticket)}
      </p>

      <div className="ticket__picote" aria-hidden="true" />

      <dl className="ticket__dados">
        <div>
          <dt>Entrada</dt>
          <dd>{dataHora(ticket.entradaEm)}</dd>
        </div>
        <div>
          <dt>Tempo de permanência</dt>
          <dd>
            <span className="relogio" aria-live="off">
              {duracao(tempoMs, estacionado)}
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
        <div className={`ticket__valor${estacionado ? '' : ' ticket__valor--final'}`}>
          <span>{estacionado ? 'Valor acumulado até agora' : 'Valor total'}</span>
          <strong>{dinheiro(ticket.valorCentavos)}</strong>
          {ticket.pagoCentavos > 0 && (
            <small>
              Já pago {dinheiro(ticket.pagoCentavos)}
              {ticket.aPagarCentavos > 0 ? ` · falta ${dinheiro(ticket.aPagarCentavos)}` : ''}
            </small>
          )}
          {ticket.proximaCobranca && (
            <small>
              Passa a {dinheiro(ticket.proximaCobranca.valorCentavos)} às {hora(ticket.proximaCobranca.em)}
            </small>
          )}
        </div>
      )}

      {ticket.itens.length > 0 && (
        <details
          className="ticket__detalhes"
          open={detalhes}
          onToggle={(e) => setDetalhes(e.currentTarget.open)}
        >
          <summary>Como o valor foi calculado</summary>
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

      <div className={`atualizacao${falha ? ' atualizacao--alerta' : ''}`} role="status">
        <p>
          <span className="mudo">Última atualização: </span>
          <time dateTime={ticket.calculadoEm}>{dataHoraCompleta(ticket.calculadoEm)}</time> (
          {haQuanto(ticket.calculadoEm, agora)})
        </p>
        {falha && <p>{falha.message} Mostrando a última informação recebida.</p>}
        {agora - Date.parse(ticket.sincronizadoEm) > 5 * 60_000 && (
          <p>
            Dados enviados pelo estacionamento em {dataHoraCompleta(ticket.sincronizadoEm)}. O valor pode
            estar desatualizado; o caixa confirma na saída.
          </p>
        )}
      </div>
      <p className="mudo pequeno">{politicaDoLink(ticket)}</p>

      <div className="ticket__acoes">
        <button type="button" className="botao botao--secundario" onClick={() => void buscar()}>
          Atualizar
        </button>
        <Esquecer confirmar={confirmar} setConfirmar={setConfirmar} onEsquecer={onEsquecer} />
      </div>
    </section>
  );
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

function ErroTicket({ falha, onEsquecer }: { falha: ErroApi; onEsquecer: () => void }) {
  return (
    <>
      <p className="alerta">
        {falha.tipo === 'NAO_ENCONTRADO'
          ? 'Não encontramos este ticket. Confira o link ou peça um novo QR Code no caixa. Depois da saída, o link funciona só pelo prazo definido pelo estacionamento.'
          : falha.message}
      </p>
      <button type="button" className="botao-texto" onClick={onEsquecer}>
        Tirar este ticket do celular
      </button>
    </>
  );
}
