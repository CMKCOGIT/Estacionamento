import { ulid } from 'ulid';
import {
  cpfValido,
  problemasDaSenha,
  type DadosAcesso,
  type DadosFuncionario,
  type FuncionarioDetalhe,
  type NovoFuncionario,
} from '@estacionamento/shared';
import { obterSiteAtual } from '../../config/site.js';
import type { Conexao } from '../../db/pool.js';
import { registrarAtividade } from '../../db/atividades.js';
import { comTransacao, type ContextoAuditoria } from '../../db/transacao.js';
import { AppError, erros } from '../../http/erros.js';
import { authRepository } from '../auth/auth.repository.js';
import type { Autenticacao } from '../auth/auth.service.js';
import { normalizarLogin } from '../auth/auth.service.js';
import { gerarHashSenha } from '../auth/senha.js';
import { usuariosRepository as repo, type FiltroListagem } from './usuarios.repository.js';

/** Quem está fazendo a operação + contexto para o histórico. */
export interface Ator {
  auth: Autenticacao;
  contexto: ContextoAuditoria;
}

const ehAdmin = (auth: Autenticacao) => auth.perfis.some((p) => p.codigo === 'admin');

function semPermissao(mensagem: string): AppError {
  return new AppError(403, 'SEM_PERMISSAO', mensagem);
}

/** Normaliza e valida os dados pessoais. */
function normalizarDados(d: DadosFuncionario) {
  const nome = d.nome.trim().replace(/\s+/g, ' ');
  if (nome.length < 3)
    throw erros.requisicaoInvalida('Informe o nome completo', [
      { campo: 'nome', mensagem: 'Nome muito curto' },
    ]);
  const cpf = d.cpf ? d.cpf.replace(/\D/g, '') : null;
  if (cpf && !cpfValido(cpf))
    throw erros.requisicaoInvalida('CPF inválido', [{ campo: 'cpf', mensagem: 'CPF inválido' }]);
  const telefone = d.telefone ? d.telefone.replace(/\D/g, '') : null;
  if (telefone && !/^\d{10,11}$/.test(telefone)) {
    throw erros.requisicaoInvalida('Telefone inválido', [
      { campo: 'telefone', mensagem: 'Use DDD + número' },
    ]);
  }
  return {
    nome,
    cpf,
    telefone,
    email: d.email?.trim().toLowerCase() || null,
    cargo: d.cargo?.trim() || null,
    dataAdmissao: d.dataAdmissao || null,
  };
}

/**
 * Regras contra escalada de privilégio:
 *  - só Administrador concede o nível Administrador ou mexe no acesso de outro admin;
 *  - quem não é admin só concede permissões que ele mesmo possui;
 *  - ninguém altera o próprio nível/permissões.
 */
async function validarAcesso(ator: Autenticacao, acesso: DadosAcesso, alvo: FuncionarioDetalhe | null) {
  if (!ator.temPermissao('usuario.gerenciar')) {
    throw semPermissao('Você não tem permissão para definir acessos ao sistema.');
  }
  if (alvo?.acesso && alvo.acesso.usuarioId === ator.id) {
    throw semPermissao('Você não pode alterar o seu próprio nível de acesso ou permissões.');
  }
  if (!ehAdmin(ator) && (acesso.nivel === 'admin' || alvo?.acesso?.nivel === 'admin')) {
    throw semPermissao('Somente um Administrador pode conceder ou alterar acesso de Administrador.');
  }
  if (acesso.nivel === 'funcionario') {
    const existentes = await repo.permissoesExistentes(acesso.permissoes);
    const invalidas = acesso.permissoes.filter((p) => !existentes.has(p));
    if (invalidas.length) {
      throw erros.requisicaoInvalida(
        'Permissão desconhecida',
        invalidas.map((p) => ({ campo: 'permissoes', mensagem: p })),
      );
    }
    if (!ehAdmin(ator)) {
      const acima = acesso.permissoes.filter((p) => !ator.temPermissao(p));
      if (acima.length) {
        throw new AppError(403, 'SEM_PERMISSAO', 'Você só pode conceder permissões que você mesmo possui.', {
          naoPermitidas: acima,
        });
      }
    }
  }
}

function validarSenhaProvisoria(senha: string | undefined, login: string): string {
  if (!senha)
    throw erros.requisicaoInvalida('Informe uma senha provisória', [
      { campo: 'senhaProvisoria', mensagem: 'Obrigatória' },
    ]);
  const problemas = problemasDaSenha(senha, login);
  if (problemas.length) {
    throw erros.requisicaoInvalida(
      'A senha provisória não atende às regras',
      problemas.map((mensagem) => ({ campo: 'senhaProvisoria', mensagem })),
    );
  }
  return senha;
}

function validarLogin(login: string): string {
  const l = normalizarLogin(login);
  if (!/^[a-z0-9._-]{3,60}$/.test(l)) {
    throw erros.requisicaoInvalida('Login inválido', [
      { campo: 'login', mensagem: 'Use 3 a 60 caracteres: letras minúsculas, números, ponto, - ou _' },
    ]);
  }
  return l;
}

/** Impede que o estacionamento fique sem nenhum Administrador ativo. */
async function garantirOutroAdmin(c: Conexao, siteId: string, usuarioId: string) {
  if ((await repo.contarAdminsAtivos(c, siteId, usuarioId)) === 0) {
    throw erros.regraDeNegocio('Este é o único Administrador ativo. Cadastre outro Administrador antes.');
  }
}

async function carregar(siteId: string, id: string, c?: Conexao): Promise<FuncionarioDetalhe> {
  const f = await repo.buscar(siteId, id, c);
  if (!f) throw erros.naoEncontrado('Funcionário não encontrado');
  return f;
}

/** Funcionário que não é admin não mexe em dados de Administrador. */
function exigirPodeAlterar(ator: Autenticacao, alvo: FuncionarioDetalhe, mexeNoAcesso = false) {
  if (alvo.acesso?.nivel === 'admin' && !ehAdmin(ator)) {
    throw semPermissao('Somente um Administrador pode alterar os dados de outro Administrador.');
  }
  if (mexeNoAcesso && alvo.acesso && !ator.temPermissao('usuario.gerenciar')) {
    throw semPermissao('Você não tem permissão para alterar o acesso ao sistema deste funcionário.');
  }
}

/** Cria ou atualiza o acesso (login, nível e permissões) dentro da transação. */
async function aplicarAcesso(
  c: Conexao,
  siteId: string,
  ator: Autenticacao,
  funcionario: { id: string; email: string | null; usuarioId: string | null; nivelAtual: string | null },
  acesso: DadosAcesso,
) {
  const login = validarLogin(acesso.login);
  if (await repo.loginEmUso(c, login, funcionario.usuarioId)) {
    throw new AppError(409, 'REGISTRO_DUPLICADO', `O login "${login}" já está em uso.`, { campo: 'login' });
  }

  let usuarioId = funcionario.usuarioId;
  if (!usuarioId) {
    const senha = validarSenhaProvisoria(acesso.senhaProvisoria, login);
    usuarioId = ulid();
    await repo.inserirUsuario(c, {
      id: usuarioId,
      login,
      email: funcionario.email,
      senhaHash: await gerarHashSenha(senha),
    });
    await repo.vincularUsuario(c, funcionario.id, usuarioId);
  } else {
    await repo.atualizarLogin(c, usuarioId, login);
    if (funcionario.nivelAtual === 'admin' && acesso.nivel !== 'admin')
      await garantirOutroAdmin(c, siteId, usuarioId);
  }

  await repo.definirNivel(c, usuarioId, siteId, acesso.nivel, ator.id);
  // Administrador já tem tudo: as permissões individuais não se aplicam.
  await repo.definirPermissoes(
    c,
    usuarioId,
    siteId,
    acesso.nivel === 'admin' ? [] : acesso.permissoes,
    ator.id,
  );
  return usuarioId;
}

export const usuariosService = {
  async listar(filtro: FiltroListagem) {
    const site = await obterSiteAtual();
    return repo.listar(site.id, filtro);
  },

  async obter(id: string) {
    const site = await obterSiteAtual();
    return carregar(site.id, id);
  },

  async criar({ auth, contexto }: Ator, dados: NovoFuncionario): Promise<FuncionarioDetalhe> {
    const site = await obterSiteAtual();
    const pessoais = normalizarDados(dados);
    if (dados.acesso) await validarAcesso(auth, dados.acesso, null);

    const id = ulid();
    await comTransacao(contexto, async (c) => {
      await repo.inserirFuncionario(c, { id, siteId: site.id, usuarioId: null, ...pessoais });
      if (dados.acesso) {
        await aplicarAcesso(
          c,
          site.id,
          auth,
          { id, email: pessoais.email, usuarioId: null, nivelAtual: null },
          dados.acesso,
        );
      }
    });
    return carregar(site.id, id);
  },

  async atualizarDados({ auth, contexto }: Ator, id: string, dados: DadosFuncionario) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    exigirPodeAlterar(auth, alvo);
    const pessoais = normalizarDados(dados);
    await comTransacao(contexto, (c) => repo.atualizarFuncionario(c, id, pessoais));
    return carregar(site.id, id);
  },

  async definirAcesso({ auth, contexto }: Ator, id: string, acesso: DadosAcesso) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    if (!alvo.ativo) throw erros.regraDeNegocio('Reative o funcionário antes de alterar o acesso.');
    await validarAcesso(auth, acesso, alvo);
    await comTransacao(contexto, (c) =>
      aplicarAcesso(
        c,
        site.id,
        auth,
        {
          id,
          email: alvo.email,
          usuarioId: alvo.acesso?.usuarioId ?? null,
          nivelAtual: alvo.acesso?.nivel ?? null,
        },
        acesso,
      ),
    );
    return carregar(site.id, id);
  },

  /** Desliga o funcionário e bloqueia o acesso imediatamente (encerra sessões). */
  async desativar({ auth, contexto }: Ator, id: string) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    exigirPodeAlterar(auth, alvo, true);
    if (alvo.acesso?.usuarioId === auth.id)
      throw semPermissao('Você não pode desativar o seu próprio usuário.');
    if (!alvo.ativo) return alvo;
    await comTransacao(contexto, async (c) => {
      const usuarioId = alvo.acesso?.usuarioId ?? null;
      if (usuarioId && alvo.acesso?.nivel === 'admin') await garantirOutroAdmin(c, site.id, usuarioId);
      await repo.definirAtivo(c, id, usuarioId, false);
      if (usuarioId) await authRepository.encerrarOutrasSessoes(c, usuarioId, 'USUARIO_DESATIVADO', null);
    });
    return carregar(site.id, id);
  },

  async reativar({ auth, contexto }: Ator, id: string) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    exigirPodeAlterar(auth, alvo, true);
    if (alvo.ativo && (alvo.acesso?.ativo ?? true)) return alvo;
    await comTransacao(contexto, (c) => repo.definirAtivo(c, id, alvo.acesso?.usuarioId ?? null, true));
    return carregar(site.id, id);
  },

  /** Define uma senha provisória; o funcionário troca no próximo login. */
  async redefinirSenha({ auth, contexto }: Ator, id: string, senhaProvisoria: string) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    exigirPodeAlterar(auth, alvo, true);
    if (!alvo.acesso) throw erros.regraDeNegocio('Este funcionário não tem acesso ao sistema.');
    if (alvo.acesso.usuarioId === auth.id) {
      throw erros.regraDeNegocio('Para trocar a sua própria senha, use "Trocar senha" no menu.');
    }
    const senha = validarSenhaProvisoria(senhaProvisoria, alvo.acesso.login);
    const hash = await gerarHashSenha(senha);
    const usuarioId = alvo.acesso.usuarioId;
    await comTransacao(contexto, async (c) => {
      await repo.redefinirSenha(c, usuarioId, hash);
      await registrarAtividade(
        {
          acao: 'usuario.senha_redefinida',
          siteId: site.id,
          usuarioId: auth.id,
          entidade: 'usuarios',
          entidadeId: usuarioId,
          correlacaoId: contexto.correlacaoId,
        },
        c,
      );
      await authRepository.encerrarOutrasSessoes(c, usuarioId, 'SENHA_ALTERADA', null);
    });
    return carregar(site.id, id);
  },

  async desbloquear({ auth, contexto }: Ator, id: string) {
    const site = await obterSiteAtual();
    const alvo = await carregar(site.id, id);
    exigirPodeAlterar(auth, alvo, true);
    if (!alvo.acesso) throw erros.regraDeNegocio('Este funcionário não tem acesso ao sistema.');
    const usuarioId = alvo.acesso.usuarioId;
    await comTransacao(contexto, async (c) => {
      if (await repo.desbloquear(c, usuarioId)) {
        await registrarAtividade(
          {
            acao: 'usuario.desbloqueado',
            siteId: site.id,
            usuarioId: auth.id,
            entidade: 'usuarios',
            entidadeId: usuarioId,
            correlacaoId: contexto.correlacaoId,
          },
          c,
        );
      }
    });
    return carregar(site.id, id);
  },
};
