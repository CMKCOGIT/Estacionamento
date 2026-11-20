import { useCallback, useEffect, useState } from 'react';
import type { TicketPublico } from '@estacionamento/shared';
import { api, ErroApi } from '../api';
import { atualizarUltimo, type TicketSalvo } from '../armazenamento';
import { Placa } from '../componentes/Placa';
import { dataHora, dinheiro, duracao, haQuanto, hora } from '../formato';

const SITUACAO: Record<TicketPublico['situacao'], { texto: string; classe: string }> = {
  ESTACIONADO: { texto: 'Estacionado', classe: 'selo--ativo' },
  ENCERRADO: { texto: 'Saída registrada', classe: 'selo--concluido' },
  CANCELADO: { texto: 'Ticket cancelado', classe: 'selo--cancelado' },
};

/**
 * Um ticket do cliente. Busca na API só pelo token deste ticket; sem
 * internet mostra a última resposta guardada, com o horário dela.
 */
export function CartaoTicket({ salvo, onEsquecer }: { salvo: TicketSalvo; onEsquecer: () => void }) {
  const [ticket, setTicket] = useState<TicketPublico | null>(salvo.ultimo);
  const [recebidoEm, setRecebidoEm] = useState<string | null>(salvo.ultimoEm);
  const [falha, setFalha] = useState<ErroApi | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [detalhes, setDetalhes] = useState(false);
  const [confirmar, setConfirmar] = useState(false);

  const buscar = useCallback(
    () =>
      api.ticket(salvo.token).then(
        (t) => {
          setTicket(t);
          setRecebidoEm(new Date().toISOString());
          setFalha(null);
          atualizarUltimo(salvo.token, t);
        },
        (e: unknown) =>
          setFalha(e instanceof ErroApi ? e : new ErroApi('INDISPONIVEL', 'Não foi possível atualizar.')),
      ),
    [salvo.token],
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
  useEffect(() => {
    if (!estacionado) return;
    const ate = proxima ? Date.parse(proxima) - Date.now() + 1000 : 60_000;
    const t = setTimeout(() => void buscar(), Math.min(Math.max(ate, 5000), 60_000));
    return () => clearTimeout(t);
  }, [estacionado, proxima, buscar, recebidoEm]);
  useEffect(() => {
    if (!estacionado) return;
    const t = setInterval(() => setAgora(Date.now()), 1000);
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

  const s = SITUACAO[ticket.situacao];
  const tempoMs = (ticket.saidaEm ? Date.parse(ticket.saidaEm) : agora) - Date.parse(ticket.entradaEm);
  const expirado = falha?.tipo === 'NAO_ENCONTRADO';
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

      <div className="ticket__picote" aria-hidden="true" />

      <dl className="ticket__dados">
        <div>
          <dt>Entrada</dt>
          <dd>{dataHora(ticket.entradaEm)}</dd>
        </div>
        <div>
          <dt>{estacionado ? 'Tempo' : 'Saída'}</dt>
          <dd>
            {estacionado ? (
              <span className="relogio">{duracao(tempoMs)}</span>
            ) : ticket.saidaEm ? (
              dataHora(ticket.saidaEm)
            ) : (
              '—'
            )}
          </dd>
        </div>
        {!estacionado && (
          <div>
            <dt>Permanência</dt>
            <dd>{duracao(tempoMs, false)}</dd>
          </div>
        )}
      </dl>

      {ticket.situacao !== 'CANCELADO' && (
        <div className={`ticket__valor${estacionado ? '' : ' ticket__valor--final'}`}>
          <span>{estacionado ? 'Valor até agora' : 'Valor total'}</span>
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
      {estacionado && (
        <p className="dica">O pagamento é feito no caixa, na saída: dinheiro, Pix ou cartão.</p>
      )}
      {ticket.situacao === 'CANCELADO' && (
        <p className="dica">Este ticket foi cancelado no caixa. Nada a pagar.</p>
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
          <p className="mudo pequeno">Tarifa da sua entrada: {ticket.tarifa}</p>
        </details>
      )}

      <p className={`atualizacao${falha ? ' atualizacao--alerta' : ''}`} role="status">
        {expirado
          ? 'Este link expirou ou foi substituído por um novo no caixa.'
          : falha
            ? `${falha.message} Mostrando o que foi recebido ${recebidoEm ? `às ${hora(recebidoEm)} (${haQuanto(recebidoEm)})` : 'antes'}.`
            : `Atualizado ${recebidoEm ? haQuanto(recebidoEm) : 'agora'}`}
        {!expirado && agora - Date.parse(ticket.sincronizadoEm) > 5 * 60_000 && (
          <> · o estacionamento enviou dados {haQuanto(ticket.sincronizadoEm)}</>
        )}
      </p>
      {ticket.acessoExpiraEm && !expirado && (
        <p className="mudo pequeno">Este link funciona até {dataHora(ticket.acessoExpiraEm)}.</p>
      )}

      <div className="ticket__acoes">
        <button type="button" className="botao botao--secundario" onClick={() => void buscar()}>
          Atualizar
        </button>
        {confirmar ? (
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
        )}
      </div>
    </section>
  );
}

function ErroTicket({ falha, onEsquecer }: { falha: ErroApi; onEsquecer: () => void }) {
  return (
    <>
      <p className="alerta">
        {falha.tipo === 'NAO_ENCONTRADO'
          ? 'Não encontramos este ticket. O link pode ter expirado (24 horas depois da saída) ou ter sido trocado por um novo no caixa.'
          : falha.message}
      </p>
      <button type="button" className="botao-texto" onClick={onEsquecer}>
        Tirar este ticket do celular
      </button>
    </>
  );
}
