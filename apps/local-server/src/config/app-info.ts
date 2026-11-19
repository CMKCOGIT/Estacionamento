import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { name: string; version: string };

export const appInfo = {
  nome: pkg.name,
  versao: pkg.version,
  iniciadoEm: new Date(),
} as const;
