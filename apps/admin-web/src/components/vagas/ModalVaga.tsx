import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  formatarCentavos,
  formatarPlaca,
  type SessaoDetalhe,
  type Vaga,
  type VagaDetalhe,
  type VeiculoDetalhe,
} from '@estacionamento/shared';
import { formatarDataHora } from '../../services/rotulos';
import { sessoesApi } from '../../services/sessoes';
import { vagasApi } from '../../services/vagas';
import { veiculosApi } from '../../services/veiculos';
import { IconeLapis, IconeSaida } from '../Icones';
import { duracaoCurta } from './MapaVagas';

export const SITUACAO_VAGA: Record<Vaga['estado'], { rotulo: string; classe: string }> = {
  LIVRE: { rotulo: 'Livre', classe: 'livre' },
  OCUPADA: { rotulo: 'Ocupada', classe: 'ocupada' },
  BLOQUEADA: { rotulo: 'Bloqueada', classe: 'bloqueada' },
  REMOVIDA: { rotulo: 'Indisponível', classe: 'indisponivel' },
};

interface Props {
  vaga: Vaga | null;
  podeGerenciar: boolean;
  podeSaida: boolean;
  onFechar: () => void;
  onSaida: () => void;
  onStatus: () => void;
  onEditar: () => void;
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="modal-vaga__secao">
      <h3>{titulo}</h3>
      <dl className="modal-vaga__dados">{children}</dl>
    </section>
  );
}
const Dado = ({ rotulo, children }: { rotulo: string; children: ReactNode }) => (
  <div>
    <dt>{rotulo}</dt>
    <dd>{children}</dd>
  </div>
);

/**
 * Detalhes da vaga num modal sobre o mapa: fecha no X, clicando fora ou com
 * Esc. Ocupada: veículo, entrada, tempo, tarifa e valor até agora.
 */
export function ModalVaga({ vaga, podeGerenciar, podeSaida, onFechar, onSaida, onStatus, onEditar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [detalhe, setDetalhe] = useState<VagaDetalhe | null>(null);
  const [sessao, setSessao] = useState<SessaoDetalhe | null>(null);
  const [veiculo, setVeiculo] = useState<VeiculoDetalhe | null>(null);
  const aberto = !!vaga;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (aberto && !d.open) d.showModal();
    if (!aberto && d.open) d.close();
  }, [aberto]);

  const sessaoId = vaga?.ocupacao?.sessaoId ?? null;
  useEffect(() => {
    if (!vaga) return;
    let ativo = true;
    vagasApi
      .obter(vaga.id)
      .then((d) => ativo && setDetalhe(d))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [vaga?.id, vaga?.estado, vaga]);
  useEffect(() => {
    if (!sessaoId) return;
    let ativo = true;
    sessoesApi
      .obter(sessaoId)
      .then((s) => {
        if (!ativo) return;
        setSessao(s);
        return veiculosApi.obter(s.veiculoId).then((v) => ativo && setVeiculo(v));
      })
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, [sessaoId]);

  const s = vaga ? SITUACAO_VAGA[vaga.estado] : null;
  const usos = vaga && detalhe?.id === vaga.id ? detalhe.ultimosUsos : null;
  const ses = sessao && sessao.id === sessaoId ? sessao : null;
  const vei = ses && veiculo?.id === ses.veiculoId ? veiculo : null;
  const modeloCor = vei ? [vei.marca, vei.modelo, vei.cor].filter(Boolean).join(' · ') : '';

  return (
    <dialog
      ref={ref}
      className="dialogo modal-vaga"
      aria-labelledby="modal-vaga-titulo"
      onCancel={(e) => {
        e.preventDefault();
        onFechar();
      }}
      // Clique no fundo escurecido (fora do conteúdo) fecha
      onClick={(e) => e.target === ref.current && onFechar()}
    >
      {vaga && s && (
        <div className="modal-vaga__conteudo">
          <header className="modal-vaga__cabeca">
            <div>
              <span className="modal-vaga__rotulo">Vaga</span>
              <h2 id="modal-vaga-titulo">{vaga.codigo}</h2>
            </div>
            <span className={`pilula pilula--${s.classe}`}>{s.rotulo}</span>
            <button type="button" className="modal-vaga__fechar" onClick={onFechar} aria-label="Fechar">
              ×
            </button>
          </header>

          <Secao titulo="Vaga">
            <Dado rotulo="Identificação">{vaga.codigo}</Dado>
            <Dado rotulo="Categoria permitida">{vaga.categoria}</Dado>
            <Dado rotulo="Setor">
              {vaga.setor ?? 'Sem setor'}
              {vaga.coberta && ' · coberta'}
            </Dado>
            <Dado rotulo="Situação">{s.rotulo}</Dado>
            {vaga.observacao && <Dado rotulo="Observação">{vaga.observacao}</Dado>}
          </Secao>

          {vaga.ocupacao && (
            <Secao titulo="Veículo estacionado">
              <Dado rotulo="Placa">
                <strong>{formatarPlaca(vaga.ocupacao.placa)}</strong>
              </Dado>
              <Dado rotulo="Modelo e cor">{modeloCor || <span className="mudo">Não cadastrados</span>}</Dado>
              <Dado rotulo="Entrada">{formatarDataHora(vaga.ocupacao.entradaEm)}</Dado>
              <Dado rotulo="Tempo estacionado">{duracaoCurta(vaga.ocupacao.permanenciaMin)}</Dado>
              <Dado rotulo="Tarifa aplicada">{ses ? ses.tarifaAplicada.nome : '…'}</Dado>
              <Dado rotulo="Valor até agora">
                {ses ? <strong>{formatarCentavos(ses.calculo.aPagarCentavos)}</strong> : '…'}
                {ses && ses.calculo.pagoCentavos > 0 && (
                  <span className="mudo pequeno">
                    {' '}
                    · já pago {formatarCentavos(ses.calculo.pagoCentavos)}
                  </span>
                )}
              </Dado>
              <Dado rotulo="Ticket">nº {vaga.ocupacao.numero}</Dado>
            </Secao>
          )}

          {vaga.bloqueio && (
            <Secao titulo={vaga.estado === 'REMOVIDA' ? 'Indisponibilidade' : 'Bloqueio'}>
              <Dado rotulo="Motivo">{vaga.bloqueio.motivo}</Dado>
              <Dado rotulo="Desde">
                {formatarDataHora(vaga.bloqueio.em)}
                {vaga.bloqueio.por && <span className="mudo"> · {vaga.bloqueio.por}</span>}
              </Dado>
            </Secao>
          )}
          {vaga.estado === 'REMOVIDA' && !vaga.bloqueio && (
            <p className="mudo pequeno">
              Vaga desativada: não recebe veículos. O histórico de uso foi preservado.
            </p>
          )}

          <details className="modal-vaga__usos">
            <summary>Últimos usos</summary>
            {!usos && <p className="mudo">Carregando…</p>}
            {usos && usos.length === 0 && <p className="mudo">Esta vaga ainda não recebeu veículos.</p>}
            {usos && usos.length > 0 && (
              <ul className="lista-simples">
                {usos.map((u) => (
                  <li key={u.sessaoId}>
                    <code>{formatarPlaca(u.placa)}</code>{' '}
                    <span className="mudo">· {formatarDataHora(u.entradaEm)}</span>
                    {u.status === 'CANCELADA' && <span className="mudo"> · cancelado</span>}
                    {u.status === 'ABERTA' && <span className="mudo"> · ainda estacionado</span>}
                  </li>
                ))}
              </ul>
            )}
          </details>

          <footer className="modal-vaga__acoes">
            {podeSaida && vaga.estado === 'OCUPADA' && (
              <button type="button" className="botao" onClick={onSaida}>
                <IconeSaida tamanho={18} /> Dar saída
              </button>
            )}
            {podeGerenciar && (
              <button type="button" className="botao botao--contorno" onClick={onStatus}>
                <IconeLapis tamanho={18} /> Alterar status
              </button>
            )}
            {podeGerenciar && vaga.estado !== 'REMOVIDA' && (
              <button type="button" className="botao-texto" onClick={onEditar}>
                Editar dados da vaga
              </button>
            )}
            <button
              type="button"
              className="botao botao--secundario modal-vaga__fechar-rodape"
              onClick={onFechar}
            >
              Fechar
            </button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
