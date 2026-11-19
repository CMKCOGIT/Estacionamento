import { createHash, randomBytes } from 'node:crypto';
import QRCode from 'qrcode';
import { formatarPlaca, type AcessoCliente } from '@estacionamento/shared';
import { env } from '../../config/env.js';

/**
 * Acesso individual do cliente ao próprio ticket (docs/ARQUITETURA.md §7.3):
 *  - token aleatório de 32 bytes (impossível de adivinhar);
 *  - só o hash SHA-256 é guardado no banco;
 *  - o token vai DEPOIS do "#" no link: o navegador não envia essa parte ao
 *    servidor web, então ela não aparece em logs;
 *  - QR Code gerado aqui, no servidor local: funciona sem internet.
 */
export function gerarToken(): { token: string; hash: Buffer } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token, 'utf8').digest() };
}

/** Enquanto o PWA não está publicado, o link aponta para este servidor (configure PUBLIC_PWA_URL). */
export function urlBaseCliente(origemDaRequisicao: string): string {
  return (env.PUBLIC_PWA_URL ?? `${origemDaRequisicao}/cliente`).replace(/\/+$/, '');
}

export async function montarAcessoCliente(
  token: string,
  dados: { numero: string; placa: string; vaga: string | null; nomeEstacionamento: string },
  origemDaRequisicao: string,
): Promise<AcessoCliente> {
  const link = `${urlBaseCliente(origemDaRequisicao)}/t#${token}`;
  const qrSvg = await QRCode.toString(link, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 220,
  });
  const mensagem =
    `${dados.nomeEstacionamento} — ticket nº ${dados.numero}, placa ${formatarPlaca(dados.placa)}` +
    `${dados.vaga ? `, vaga ${dados.vaga}` : ''}. Acompanhe o tempo e o valor: ${link}`;
  return { link, qrSvg, mensagem };
}
