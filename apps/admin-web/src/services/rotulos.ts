import type { SituacaoAcesso } from '@estacionamento/shared';

/** Texto amigável de cada ação do histórico (historico_atividades.acao). */
export const ROTULOS_ACOES: Record<string, string> = {
  'auth.login': 'Entrou no sistema',
  'auth.logout': 'Saiu do sistema',
  'auth.login_falhou': 'Tentativa de login falhou',
  'auth.login_recusado_bloqueio': 'Login recusado (conta bloqueada)',
  'sessao.entrada': 'Entrada de veículo',
  'sessao.encerrada': 'Saída de veículo',
  'sessao.cancelada': 'Ticket cancelado',
  'sessao.alterada': 'Ticket alterado',
  'sessao.anonimizada': 'Ticket anonimizado (retenção)',
  'ticket.token_revogado': 'QR Code do cliente revogado',
  'pagamento.registrado': 'Pagamento registrado',
  'pagamento.estornado': 'Pagamento estornado',
  'caixa.aberto': 'Caixa aberto',
  'caixa.fechado': 'Caixa fechado',
  'tarifa.rascunho_criado': 'Nova versão de tarifas criada',
  'tarifa.publicada': 'Tabela de tarifas publicada',
  'tarifa.arquivada': 'Tabela de tarifas arquivada',
  'tarifa.rascunho_excluido': 'Rascunho de tarifa excluído',
  'vaga.criada': 'Vaga criada',
  'vaga.alterada': 'Vaga alterada',
  'vaga.excluida': 'Vaga excluída',
  'categoria.excluida': 'Categoria de veículo excluída',
  'cliente.excluido': 'Cliente excluído',
  'veiculo.excluido': 'Veículo excluído',
  'posto.excluido': 'Posto excluído',
  'funcionario.cadastrado': 'Funcionário cadastrado',
  'funcionario.alterado': 'Dados de funcionário alterados',
  'funcionario.desligado': 'Funcionário desativado',
  'funcionario.readmitido': 'Funcionário reativado',
  'usuario.criado': 'Acesso ao sistema criado',
  'usuario.alterado': 'Acesso ao sistema alterado',
  'usuario.senha_alterada': 'Senha alterada',
  'usuario.senha_redefinida': 'Senha redefinida pelo administrador',
  'usuario.bloqueado': 'Conta bloqueada por tentativas',
  'usuario.desbloqueado': 'Conta desbloqueada',
  'usuario.perfil_concedido': 'Nível de acesso concedido',
  'usuario.perfil_removido': 'Nível de acesso removido',
  'usuario.permissao_concedida': 'Permissão concedida',
  'usuario.permissao_removida': 'Permissão removida',
  'perfil.permissao_concedida': 'Permissão adicionada a um modelo',
  'perfil.permissao_removida': 'Permissão removida de um modelo',
  'config.criada': 'Configuração criada',
  'config.alterada': 'Configuração alterada',
};

export const MODULOS_HISTORICO: { codigo: string; nome: string }[] = [
  { codigo: 'sessao', nome: 'Entrada e saída' },
  { codigo: 'pagamento', nome: 'Pagamentos' },
  { codigo: 'caixa', nome: 'Caixa' },
  { codigo: 'tarifa', nome: 'Tarifas' },
  { codigo: 'vaga', nome: 'Vagas' },
  { codigo: 'funcionario', nome: 'Funcionários' },
  { codigo: 'usuario', nome: 'Usuários e permissões' },
  { codigo: 'auth', nome: 'Login e logout' },
  { codigo: 'config', nome: 'Configurações' },
];

export const ROTULOS_SITUACAO: Record<SituacaoAcesso, string> = {
  ATIVO: 'Ativo',
  BLOQUEADO: 'Bloqueado',
  INATIVO: 'Inativo',
  SEM_ACESSO: 'Sem acesso ao sistema',
};

export function formatarDataHora(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
