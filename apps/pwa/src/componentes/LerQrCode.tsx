import { useEffect, useRef, useState } from 'react';
import { salvarToken } from '../armazenamento';
import { tokenDoLink } from '../token';

/** Tira o token de um link de ticket (`.../t#<token>`) ou do próprio token. */
export function tokenDeTexto(texto: string): string | null {
  const t = texto.trim();
  try {
    const u = new URL(t);
    return tokenDoLink(u.hash);
  } catch {
    return tokenDoLink(t);
  }
}

type Leitor = (img: ImageData) => Promise<string | null>;

/** Leitor nativo (Android/Chrome) ou jsQR (iPhone e os demais), carregado só quando preciso. */
async function criarLeitor(): Promise<Leitor> {
  const Nativo = (
    globalThis as {
      BarcodeDetector?: new (o: object) => { detect(i: ImageData): Promise<{ rawValue: string }[]> };
    }
  ).BarcodeDetector;
  if (Nativo) {
    try {
      const d = new Nativo({ formats: ['qr_code'] });
      return async (img) => (await d.detect(img))[0]?.rawValue ?? null;
    } catch {
      // formato não suportado: cai no jsQR
    }
  }
  const { default: jsQR } = await import('jsqr');
  return async (img) =>
    jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/**
 * "Ler QR Code do ticket" DENTRO do app. Necessário no iPhone: o app
 * instalado não enxerga o que foi aberto no Safari (cada um tem os seus dados).
 */
export function LerQrCode({ onLido, onFechar }: { onLido: () => void; onFechar: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [colado, setColado] = useState('');

  useEffect(() => {
    let ativo = true;
    let stream: MediaStream | null = null;
    let quadro = 0;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setErro('Este navegador não deixa usar a câmera. Cole o link do ticket abaixo.');
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        });
      } catch (e) {
        const nome = (e as Error).name;
        setErro(
          nome === 'NotAllowedError'
            ? 'O acesso à câmera foi negado. Libere a câmera para este app nos ajustes do celular, ou cole o link do ticket abaixo.'
            : 'Não foi possível abrir a câmera. Cole o link do ticket abaixo.',
        );
        return;
      }
      if (!ativo || !video.current) return;
      video.current.srcObject = stream;
      await video.current.play().catch(() => undefined);
      const ler = await criarLeitor();
      const passo = async () => {
        if (!ativo || !video.current || !ctx) return;
        const v = video.current;
        if (v.readyState >= 2 && v.videoWidth) {
          const escala = Math.min(1, 640 / v.videoWidth);
          canvas.width = Math.round(v.videoWidth * escala);
          canvas.height = Math.round(v.videoHeight * escala);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const texto = await ler(ctx.getImageData(0, 0, canvas.width, canvas.height)).catch(() => null);
          if (texto) {
            const token = tokenDeTexto(texto);
            if (token) {
              salvarToken(token);
              ativo = false;
              onLido();
              return;
            }
            setAviso('Este QR Code não é de um ticket do estacionamento.');
          }
        }
        quadro = window.setTimeout(() => void passo(), 200);
      };
      void passo();
    })();
    return () => {
      ativo = false;
      clearTimeout(quadro);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onLido]);

  function usarColado() {
    const token = tokenDeTexto(colado);
    if (!token) {
      setAviso('Link inválido. Ele deve terminar com /t# seguido do código do ticket.');
      return;
    }
    salvarToken(token);
    onLido();
  }

  return (
    <section className="cartao leitor" aria-label="Ler QR Code do ticket">
      <div className="leitor__topo">
        <h2>Ler QR Code do ticket</h2>
        <button type="button" className="botao-texto" onClick={onFechar}>
          Fechar
        </button>
      </div>
      {!erro && (
        <div className="leitor__video">
          <video ref={video} playsInline muted aria-label="Câmera" />
          <span className="leitor__mira" aria-hidden="true" />
        </div>
      )}
      {!erro && <p className="mudo pequeno">Aponte a câmera para o QR Code do caixa ou do comprovante.</p>}
      {erro && (
        <p className="alerta" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p className="alerta" role="status">
          {aviso}
        </p>
      )}
      <details className="leitor__colar" open={!!erro}>
        <summary>Prefiro colar o link</summary>
        <div className="leitor__linha">
          <input
            value={colado}
            onChange={(e) => setColado(e.target.value)}
            placeholder="https://…/t#…"
            inputMode="url"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="Link do ticket"
          />
          <button type="button" className="botao" onClick={usarColado} disabled={!colado.trim()}>
            Abrir
          </button>
        </div>
      </details>
    </section>
  );
}
