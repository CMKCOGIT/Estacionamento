/**
 * Configuração inicial / novo administrador.
 *
 *   npm run usuario:admin
 *
 * Pergunta o nome do estacionamento (só na primeira vez), o nome, o login e a
 * senha do administrador. A senha não aparece na tela enquanto é digitada.
 */
import { createInterface } from 'node:readline';
import { stdin, stdout } from 'node:process';
import { POLITICA_SENHA, problemasDaSenha } from '@estacionamento/shared';
import { fecharPool } from '../src/db/pool.js';
import { AppError } from '../src/http/erros.js';
import { criarAdministrador, existeEstacionamento } from '../src/modules/instalacao/instalacao.service.js';

const rl = createInterface({ input: stdin, output: stdout, terminal: true });
let ocultar = false;
// Enquanto `ocultar` estiver ligado, nada do que é digitado é mostrado.
const rlInterno = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
const escreverOriginal = rlInterno._writeToOutput.bind(rl);
rlInterno._writeToOutput = (s: string) => {
  if (!ocultar || s.includes('\n') || s.includes('\r')) escreverOriginal(ocultar ? '\n' : s);
};

function perguntar(texto: string, opcoes: { oculto?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    // O readline escreve a pergunta de forma síncrona; só depois passamos a ocultar.
    rl.question(texto, (resposta) => {
      ocultar = false;
      resolve(resposta.trim());
    });
    ocultar = Boolean(opcoes.oculto);
  });
}

async function principal() {
  console.log('\n=== Configuração do administrador ===\n');

  let nomeEstacionamento: string | undefined;
  if (!(await existeEstacionamento())) {
    console.log('Nenhum estacionamento cadastrado ainda. Vamos criar.');
    nomeEstacionamento = await perguntar('Nome do estacionamento: ');
  }

  const nome = await perguntar('Nome completo do administrador: ');
  const login = (await perguntar('Login (ex.: admin): ')).toLowerCase();

  let senha: string;
  for (;;) {
    senha = await perguntar(`Senha (mín. ${POLITICA_SENHA.minimo}, letras e números): `, { oculto: true });
    const problemas = problemasDaSenha(senha, login);
    if (problemas.length) {
      console.log(`  ✘ ${problemas.join('; ')}`);
      continue;
    }
    const confirmacao = await perguntar('Confirme a senha: ', { oculto: true });
    if (confirmacao !== senha) {
      console.log('  ✘ As senhas não conferem');
      continue;
    }
    break;
  }

  const r = await criarAdministrador({ nomeEstacionamento, nome, login, senha });
  console.log(`\n✔ ${r.siteCriado ? 'Estacionamento e administrador criados' : 'Administrador criado'}.`);
  console.log(`  Entre no painel com o login "${r.login}".\n`);
}

try {
  await principal();
} catch (erro) {
  const msg = erro instanceof AppError ? erro.message : (erro as Error).message;
  console.error(`\nFalha: ${msg}\n`);
  process.exitCode = 1;
} finally {
  rl.close();
  await fecharPool();
}
