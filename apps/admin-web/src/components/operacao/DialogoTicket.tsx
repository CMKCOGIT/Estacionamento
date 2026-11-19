import { useEffect, useRef, useState } from 'react';
import type { AcessoCliente, SessaoDetalhe } from '@estacionamento/shared';
import { formatarDataHora } from '../../services/rotulos';
import { Placa } from '../Placa';
import { copiarTexto } from './util';

interface Props {
  sessao: SessaoDetalhe;
  acesso: AcessoCliente;
  /** "Entrada registrada" ou "Novo link gerado". */
  titulo: string;
  veiculoCadastradoAgora?: boolean;
  onFechar: () => void;
}

/**
 * Ticket do cliente: QR Code para ler na tela (ou no monitor voltado ao cliente),
 * link para copiar e atalho para enviar pelo WhatsApp. O link só existe agora:
 * o servidor guarda apenas o "hash" do código.
 */
export function DialogoTicket({ sessao, acesso, titulo, veiculoCadastradoAgora, onFechar }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copiado, setCopiado] = useState<'ok' | 'falhou' | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function copiar() {
    setCopiado((await copiarTexto(acesso.link)) ? 'ok' : 'falhou');
  }

  return (
    <dialog ref={ref} className="dialogo dialogo--ticket" onClose={onFechar} aria-labelledby="ticket-titulo">
      <h2 id="ticket-titulo">{titulo}</h2>
      <div className="ticket">
        <div className="ticket__dados">
          <p className="ticket__numero">
            Ticket <strong>nº {sessao.numero}</strong>
          </p>
          <Placa placa={sessao.placa} grande />
          <dl className="lista-dados">
            <dt>Vaga</dt>
            <dd>
              <strong>{sessao.vaga ?? '—'}</strong>
            </dd>
            <dt>Categoria</dt>
            <dd>{sessao.categoria}</dd>
            <dt>Entrada</dt>
            <dd>{formatarDataHora(sessao.entradaEm)}</dd>
          </dl>
          {veiculoCadastradoAgora && <p className="pequeno mudo">Veículo cadastrado agora.</p>}
        </div>
        {/* SVG gerado pelo próprio servidor local (biblioteca qrcode), sem internet */}
        <div
          className="ticket__qr"
          role="img"
          aria-label={`QR Code do ticket nº ${sessao.numero}`}
          dangerouslySetInnerHTML={{ __html: acesso.qrSvg }}
        />
      </div>
      <p className="pequeno mudo">
        O cliente lê o QR Code com a câmera do celular para acompanhar o tempo e o valor.
      </p>

      <label className="campo">
        <span>Link do cliente</span>
        <input value={acesso.link} readOnly onFocus={(e) => e.target.select()} spellCheck={false} />
      </label>
      {copiado && (
        <p className={`alerta alerta--${copiado === 'ok' ? 'ok' : 'erro'}`} role="status">
          {copiado === 'ok'
            ? 'Link copiado.'
            : 'Não foi possível copiar. Selecione o link e copie com Ctrl+C.'}
        </p>
      )}
      <div className="acoes acoes--direita acoes--quebrar">
        <button type="button" className="botao botao--secundario" onClick={() => void copiar()}>
          Copiar link
        </button>
        <a
          className="botao botao--secundario"
          href={`https://wa.me/?text=${encodeURIComponent(acesso.mensagem)}`}
          target="_blank"
          rel="noreferrer"
        >
          Enviar no WhatsApp
        </a>
        <button type="button" className="botao" onClick={() => ref.current?.close()} autoFocus>
          Concluir
        </button>
      </div>
    </dialog>
  );
}
