import { useCallback, useEffect, useRef, useState } from 'react';
import type { TicketPublico } from '@estacionamento/shared';
import { api, ErroApi } from '../api';
import { apagarDadosPessoais, atualizarUltimo, esquecer, type TicketSalvo } from '../armazenamento';
import { proximaConsultaEm } from './regras';

export interface ConsultaTicket {
  ticket: TicketPublico | null;
  /** Relógio do celular quando chegou a última resposta boa (null = só a cópia guardada). */
  recebidoEm: number | null;
  /** Relógio do servidor − relógio do celular, medido na última resposta. */
  desvioRelogioMs: number;
  falha: ErroApi | null;
  falhasSeguidas: number;
  consultando: boolean;
  /** Relógio do celular em que a próxima consulta automática vai acontecer. */
  proximaEm: number | null;
  /** Consulta agora (botão "Atualizar" / "Tentar agora"). */
  atualizar: () => void;
}

/**
 * Atualização periódica do ticket pela API externa:
 *  - estacionado: a cada 30 s e no instante em que o valor sobe;
 *  - falha: novas tentativas automáticas com espera crescente (5 s → 60 s);
 *  - internet voltou / app voltou para a tela: consulta na hora;
 *  - sem internet: marca a falha imediatamente (não espera o tempo limite);
 *  - app em segundo plano: não consulta (economiza bateria e dados).
 * Respostas fora de ordem são descartadas: a tela nunca volta para um dado mais antigo.
 */
export function useConsultaTicket(salvo: TicketSalvo): ConsultaTicket {
  const [ticket, setTicket] = useState<TicketPublico | null>(salvo.ultimo);
  const [recebidoEm, setRecebidoEm] = useState<number | null>(null);
  const [desvio, setDesvio] = useState(0);
  const [falha, setFalha] = useState<ErroApi | null>(null);
  const [falhasSeguidas, setFalhasSeguidas] = useState(0);
  const [consultando, setConsultando] = useState(false);
  const [proximaEm, setProximaEm] = useState<number | null>(null);
  const sequencia = useRef(0);
  const emAndamento = useRef(false);
  const jaFuncionou = useRef(salvo.ultimo !== null);
  const token = salvo.token;

  const consultar = useCallback(() => {
    if (emAndamento.current) return;
    emAndamento.current = true;
    const minha = ++sequencia.current;
    const inicio = Date.now();
    void Promise.resolve()
      .then(() => {
        setConsultando(true);
        if (navigator.onLine === false) throw new ErroApi('SEM_CONEXAO', 'Sem conexão com a internet.');
        return api.ticket(token);
      })
      .then(
        (t) => {
          if (minha !== sequencia.current) return;
          const chegou = Date.now();
          // Relógio do servidor no meio do caminho da requisição
          setDesvio(Date.parse(t.calculadoEm) - (inicio + chegou) / 2);
          setTicket((atual) =>
            atual && Date.parse(atual.calculadoEm) > Date.parse(t.calculadoEm) ? atual : t,
          );
          setRecebidoEm(chegou);
          setFalha(null);
          setFalhasSeguidas(0);
          jaFuncionou.current = true;
          atualizarUltimo(token, t);
        },
        (e: unknown) => {
          if (minha !== sequencia.current) return;
          const erro = e instanceof ErroApi ? e : new ErroApi('INDISPONIVEL', 'Não foi possível atualizar.');
          if (erro.tipo === 'NAO_ENCONTRADO') {
            // Link que nunca funcionou (digitado/alterado) não fica guardado; os que já funcionaram perdem os dados pessoais
            if (jaFuncionou.current) apagarDadosPessoais(token);
            else esquecer(token);
          }
          setFalha(erro);
          setFalhasSeguidas((n) => n + 1);
        },
      )
      .finally(() => {
        emAndamento.current = false;
        setConsultando(false);
      });
  }, [token]);

  // Agenda a próxima consulta a partir do estado atual
  const situacao = ticket?.situacao ?? null;
  const proximaCobrancaEm = ticket?.proximaCobranca?.em ?? null;
  useEffect(() => {
    if (consultando) return;
    const espera = proximaConsultaEm({
      situacao,
      proximaCobrancaEm,
      desvioRelogioMs: desvio,
      falhasSeguidas,
      ultimaFalha: falha?.tipo ?? null,
      agora: Date.now(),
    });
    if (espera === null) {
      const t = setTimeout(() => setProximaEm(null), 0);
      return () => clearTimeout(t);
    }
    const quando = Date.now() + espera;
    const marcar = setTimeout(() => setProximaEm(quando), 0);
    const t = setTimeout(() => {
      if (document.visibilityState !== 'hidden') consultar();
    }, espera);
    return () => {
      clearTimeout(marcar);
      clearTimeout(t);
    };
  }, [consultando, situacao, proximaCobrancaEm, desvio, falhasSeguidas, falha, recebidoEm, consultar]);

  // Primeira consulta, volta da internet, volta para a tela, perda da internet
  useEffect(() => {
    consultar();
    const visivel = () => {
      if (document.visibilityState === 'visible') consultar();
    };
    const semRede = () => {
      sequencia.current++; // descarta a consulta em andamento (vai falhar pelo tempo limite)
      emAndamento.current = false;
      setFalha(new ErroApi('SEM_CONEXAO', 'Sem conexão com a internet.'));
      setFalhasSeguidas((n) => Math.max(n, 1));
      setConsultando(false);
    };
    document.addEventListener('visibilitychange', visivel);
    window.addEventListener('online', consultar);
    window.addEventListener('offline', semRede);
    return () => {
      document.removeEventListener('visibilitychange', visivel);
      window.removeEventListener('online', consultar);
      window.removeEventListener('offline', semRede);
    };
  }, [consultar]);

  return {
    ticket,
    recebidoEm,
    desvioRelogioMs: desvio,
    falha,
    falhasSeguidas,
    consultando,
    proximaEm,
    atualizar: consultar,
  };
}
