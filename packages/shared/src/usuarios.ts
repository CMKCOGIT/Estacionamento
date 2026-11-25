/** Contratos do módulo de usuários e funcionários. */

/**
 * Três níveis. "funcionario" é o Operador (o código foi mantido para não
 * mexer nos registros antigos).
 */
export type NivelAcesso = 'admin' | 'gerente' | 'funcionario';

export const NIVEIS_ACESSO: { codigo: NivelAcesso; nome: string; descricao: string }[] = [
  { codigo: 'admin', nome: 'Administrador', descricao: 'Proprietário: acesso completo ao sistema' },
  {
    codigo: 'gerente',
    nome: 'Gerente',
    descricao: 'Supervisiona o dia a dia: caixas, relatórios, ajustes dentro do limite definido',
  },
  {
    codigo: 'funcionario',
    nome: 'Operador',
    descricao: 'Atendimento: entradas, saídas, consulta de veículos e recebimento',
  },
];

/** Permissões que só o Administrador tem (nunca concedidas a Gerente ou Operador). */
export const PERMISSOES_SO_ADMIN = [
  'backup.gerenciar',
  'config.seguranca',
  'perfil.gerenciar',
  'usuario.sessoes',
] as const;

/** Permissões de supervisão: Gerente pode ter, Operador não. */
export const PERMISSOES_SO_GERENCIA = [
  'tarifa.gerenciar',
  'tarifa.publicar',
  'relatorio.financeiro',
  'funcionario.gerenciar',
  'usuario.gerenciar',
  'config.gerenciar',
  'caixa.supervisionar',
  'pagamento.estornar',
  'sessao.cancelar',
  'auditoria.ver',
  'sync.gerenciar',
  'lgpd.atender',
  'sistema.monitorar',
] as const;

/** O nível permite esta permissão? (o servidor também confere a cada requisição) */
export function permissaoCabeNoNivel(nivel: NivelAcesso, codigo: string): boolean {
  if (nivel === 'admin') return true;
  if ((PERMISSOES_SO_ADMIN as readonly string[]).includes(codigo)) return false;
  if (nivel === 'gerente') return true;
  return !(PERMISSOES_SO_GERENCIA as readonly string[]).includes(codigo);
}

export const nomeDoNivel = (n: NivelAcesso | null | undefined) =>
  NIVEIS_ACESSO.find((x) => x.codigo === n)?.nome ?? 'Sem acesso';

export type SituacaoAcesso = 'ATIVO' | 'BLOQUEADO' | 'INATIVO' | 'SEM_ACESSO';

export interface AcessoResumo {
  usuarioId: string;
  login: string;
  nivel: NivelAcesso | null;
  ativo: boolean;
  bloqueadoAte: string | null;
  deveTrocarSenha: boolean;
  ultimoLoginEm: string | null;
}

export interface FuncionarioResumo {
  id: string;
  nome: string;
  cargo: string | null;
  ativo: boolean;
  situacao: SituacaoAcesso;
  /** Data de cadastro do funcionário. */
  cadastradoEm: string;
  acesso: AcessoResumo | null;
}

export interface FuncionarioDetalhe extends FuncionarioResumo {
  cpf: string | null;
  telefone: string | null;
  email: string | null;
  dataAdmissao: string | null;
  dataDesligamento: string | null;
  /** Permissões marcadas individualmente (nível Funcionário). */
  permissoes: string[];
  sessoesAtivas: number;
  criadoEm: string;
  atualizadoEm: string;
}

export interface DadosFuncionario {
  nome: string;
  cpf?: string | null;
  telefone?: string | null;
  email?: string | null;
  cargo?: string | null;
  dataAdmissao?: string | null;
}

export interface DadosAcesso {
  login: string;
  nivel: NivelAcesso;
  /** Ignorado para Administrador (que tem tudo). */
  permissoes: string[];
  /** Obrigatória ao criar o acesso; o funcionário troca no primeiro login. */
  senhaProvisoria?: string;
}

export interface NovoFuncionario extends DadosFuncionario {
  acesso?: DadosAcesso | null;
}

export interface PermissaoInfo {
  codigo: string;
  modulo: string;
  descricao: string;
}

export interface ModeloPermissoes {
  codigo: string;
  nome: string;
  descricao: string | null;
  permissoes: string[];
}

export interface CatalogoPermissoes {
  modulos: { codigo: string; nome: string; permissoes: PermissaoInfo[] }[];
  modelos: ModeloPermissoes[];
}

/** Nome amigável dos módulos (coluna permissoes.modulo). */
export const NOMES_MODULOS: Record<string, string> = {
  sessoes: 'Entrada e saída de veículos',
  financeiro: 'Pagamentos e caixa',
  vagas: 'Vagas e capacidade',
  tarifas: 'Tarifas',
  cadastros: 'Clientes e veículos',
  relatorios: 'Relatórios',
  acesso: 'Usuários e acesso',
  sistema: 'Sistema',
};

export interface AtividadeRegistrada {
  id: string;
  criadoEm: string;
  usuario: { id: string; nome: string; login: string } | null;
  acao: string;
  entidade: string | null;
  entidadeId: string | null;
  dadosAnteriores: unknown;
  dadosNovos: unknown;
  motivo: string | null;
  origem: 'APP' | 'DB';
  ip: string | null;
}

export interface PaginaAtividades {
  itens: AtividadeRegistrada[];
  /** Passe em `antesDe` para buscar a próxima página; null = acabou. */
  proximaPagina: string | null;
}

/** Valida CPF pelos dígitos verificadores. Aceita com ou sem pontuação. */
export function cpfValido(cpf: string): boolean {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digito = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(d[9]) && digito(10) === Number(d[10]);
}

export function formatarCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : cpf;
}
