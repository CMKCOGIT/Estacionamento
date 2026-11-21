import { descreverErroConexao } from '../db/saude.js';
import { AppError } from './erros.js';

interface ErroMysql {
  code?: string;
  errno?: number;
  sqlState?: string;
  sqlMessage?: string;
}

/** Mensagens específicas para as restrições de unicidade mais importantes. */
const MENSAGENS_UNICIDADE: Record<string, string> = {
  uq_sessoes_vaga_aberta: 'Esta vaga já está ocupada por outro veículo.',
  uq_sessoes_veiculo_aberto: 'Este veículo já está estacionado.',
  uq_vagas_codigo: 'Já existe uma vaga com este código.',
  uq_veiculos_placa: 'Já existe um veículo cadastrado com esta placa.',
  uq_categorias_codigo: 'Já existe uma categoria com este código.',
  uq_pagamentos_idempotencia: 'Este pagamento já foi registrado.',
  uq_usuarios_login: 'Este login já está em uso.',
  uq_usuarios_email: 'Este e-mail já está em uso por outro usuário.',
  uq_funcionarios_cpf: 'Já existe um funcionário cadastrado com este CPF.',
  uq_clientes_documento: 'Já existe um cliente cadastrado com este CPF/CNPJ.',
  uq_postos_nome: 'Já existe um posto com este nome.',
  uq_sites_slug: 'Este endereço do estacionamento já está em uso.',
  uq_caixa_posto_aberto: 'Já existe um caixa aberto neste posto.',
  uq_caixa_operador_aberto: 'Você já tem um caixa aberto.',
  uq_regras_padrao:
    'Esta categoria já tem tarifa padrão nesta versão. Edite a existente ou crie uma tarifa especial.',
  uq_tabelas_versao: 'Outra versão da tabela foi criada ao mesmo tempo. Atualize a tela.',
};

const ERROS_DE_CONEXAO = new Set([
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'PROTOCOL_CONNECTION_LOST',
  'ER_ACCESS_DENIED_ERROR',
  'ER_BAD_DB_ERROR',
  'ER_CON_COUNT_ERROR',
]);

/**
 * Traduz erros do MySQL (restrições, triggers, conexão) em erros HTTP.
 * Retorna `null` se não for um erro conhecido do banco.
 *
 * As mensagens dos triggers (SIGNAL SQLSTATE '45000') já são escritas em
 * português para o usuário final e são repassadas como estão.
 */
export function traduzirErroMysql(erro: unknown): AppError | null {
  if (typeof erro !== 'object' || erro === null) return null;
  const e = erro as ErroMysql;

  if (e.code && ERROS_DE_CONEXAO.has(e.code)) {
    return new AppError(503, 'BANCO_INDISPONIVEL', `Banco de dados indisponível: ${descreverErroConexao(e)}`);
  }

  switch (e.errno) {
    case 1644: // ER_SIGNAL_EXCEPTION — regra de negócio dos triggers
      return new AppError(422, 'REGRA_DE_NEGOCIO', e.sqlMessage ?? 'Operação não permitida');

    case 1062: {
      // ER_DUP_ENTRY: "Duplicate entry 'X' for key 'tabela.uq_nome'"
      const indice = /for key '(?:[^.']+\.)?([^']+)'/.exec(e.sqlMessage ?? '')?.[1];
      const mensagem = (indice && MENSAGENS_UNICIDADE[indice]) ?? 'Já existe um registro com esses dados';
      return new AppError(409, 'REGISTRO_DUPLICADO', mensagem, {
        ...(indice && { restricao: indice }),
      });
    }

    case 3819: {
      // ER_CHECK_CONSTRAINT_VIOLATED: "Check constraint 'ck_x' is violated."
      const restricao = /constraint '([^']+)'/.exec(e.sqlMessage ?? '')?.[1];
      return new AppError(422, 'DADOS_INVALIDOS', 'Os dados informados não atendem às regras do cadastro', {
        ...(restricao && { restricao }),
      });
    }

    case 1213: // ER_LOCK_DEADLOCK (depois das repetições automáticas)
    case 1205: // ER_LOCK_WAIT_TIMEOUT
      return new AppError(
        409,
        'CONFLITO',
        'Outra operação estava alterando os mesmos dados. Tente novamente.',
      );

    case 1452: // ER_NO_REFERENCED_ROW_2
      return new AppError(422, 'DADOS_INVALIDOS', 'Um dos registros relacionados não existe');

    case 1451: // ER_ROW_IS_REFERENCED_2
      return new AppError(409, 'REGISTRO_EM_USO', 'O registro está em uso e não pode ser removido');

    case 1048: // ER_BAD_NULL_ERROR
    case 1406: // ER_DATA_TOO_LONG
    case 1264: // ER_WARN_DATA_OUT_OF_RANGE
    case 1366: // ER_TRUNCATED_WRONG_VALUE_FOR_FIELD
      return new AppError(422, 'DADOS_INVALIDOS', 'Valor inválido para um dos campos');

    default:
      return null;
  }
}
