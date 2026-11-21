/**
 * Gera um certificado HTTPS para o painel na rede local do estacionamento.
 *
 *   npm run https:certificado -w @estacionamento/local-server
 *
 * O certificado vale para "localhost", o nome deste computador e todos os
 * IPs dele na rede. Por ser autoassinado, cada navegador mostra um aviso na
 * primeira vez: instale certificados/servidor.crt como "Autoridade de
 * certificação raiz confiável" nos computadores do caixa para não ver mais
 * o aviso (veja docs/SEGURANCA.md). Validade: 825 dias.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import selfsigned from 'selfsigned';

const pasta = fileURLToPath(new URL('../certificados/', import.meta.url));
const ips = Object.values(networkInterfaces())
  .flat()
  .filter((i) => i && i.family === 'IPv4')
  .map((i) => i!.address);
const nomes = [...new Set(['localhost', hostname(), `${hostname()}.local`])];

const r = await selfsigned.generate([{ name: 'commonName', value: hostname() }], {
  notAfterDate: new Date(Date.now() + 825 * 86_400_000),
  keySize: 2048,
  algorithm: 'sha256',
  extensions: [
    { name: 'basicConstraints', cA: true },
    { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: [
        ...nomes.map((value) => ({ type: 2 as const, value })),
        ...ips.map((ip) => ({ type: 7 as const, ip })),
      ],
    },
  ],
});
mkdirSync(pasta, { recursive: true });
writeFileSync(`${pasta}servidor.crt`, r.cert);
writeFileSync(`${pasta}servidor.key`, r.private, { mode: 0o600 });

console.log('Certificado gerado em apps/local-server/certificados/ (nunca envie a .key para ninguém).');
console.log(`Vale para: ${[...nomes, ...ips].join(', ')}\n`);
console.log('Acrescente no apps/local-server/.env e reinicie o servidor:');
console.log('  HTTPS_CERT_FILE=certificados/servidor.crt');
console.log('  HTTPS_KEY_FILE=certificados/servidor.key');
console.log('  HTTP_REDIRECIONAR_PORTA=80   (opcional: http:// vai para o https://)');
