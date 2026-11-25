/**
 * Política de acesso do cliente ao próprio ticket (link/QR Code do app).
 * O link nunca expira enquanto o veículo está no estacionamento; depois da
 * saída, continua funcionando por `horasAposSaida` horas (0 = encerra na
 * saída). Ticket cancelado: o acesso termina na hora.
 */
export interface PoliticaAcessoCliente {
  horasAposSaida: number;
}

export const POLITICA_ACESSO_PADRAO: PoliticaAcessoCliente = { horasAposSaida: 24 };
/** Limite: uma semana (o link dá acesso à placa; não deve valer para sempre). */
export const HORAS_APOS_SAIDA_MAX = 168;

// ---------------------------------------------------------------------------
// Configurações por categoria (tabela `configuracoes`, uma chave por categoria)
// ---------------------------------------------------------------------------

/** Dados do estacionamento (aparecem no painel e nos comprovantes). */
export interface DadosEstacionamento {
  nome: string;
  endereco: string | null;
  telefone: string | null;
  /** Texto livre, ex.: "Seg a sex 7h–22h; sáb 8h–14h". */
  horarioFuncionamento: string | null;
  /** Imagem PNG, JPEG ou WebP em data URL (até LOGO_MAX_BYTES). */
  logo: string | null;
}
export const LOGO_MAX_BYTES = 200 * 1024;

/** Preferências da operação de entrada e saída. */
export interface PreferenciasOperacao {
  /** Na entrada, já vem marcada a "vaga automática" (a primeira livre da categoria). */
  vagaAutomatica: boolean;
  /** Mostra o QR Code do cliente logo depois de registrar a entrada. */
  mostrarQrNaEntrada: boolean;
  /** Pede confirmação antes de encerrar a saída. */
  confirmarSaida: boolean;
  /** Avisa no Painel quando um veículo passar deste tempo estacionado (0 = não avisa). */
  alertaPermanenciaHoras: number;
}

/** Segurança e acessos (somente Administrador). */
export interface ConfiguracaoSeguranca {
  /** Minutos sem uso até a sessão expirar. */
  inatividadeMin: number;
  /** Duração máxima de uma sessão (um turno). */
  duracaoMaxHoras: number;
  /** Senhas erradas seguidas até bloquear a conta. */
  maxTentativas: number;
  /** Minutos de bloqueio da conta. */
  bloqueioMin: number;
  senhaMinimo: number;
  senhaExigirMaiuscula: boolean;
  senhaExigirSimbolo: boolean;
  /** Só aceita login de computadores da rede local (IPs privados). */
  somenteRedeLocal: boolean;
}

/** Limite de desconto que cada nível pode conceder sozinho (Administrador: sem limite). */
export interface LimiteAjuste {
  /** Percentual máximo do valor calculado (0–100). */
  percentualMax: number;
  /** Valor máximo em centavos (0 = sem limite em reais, vale só o percentual). */
  valorMaxCentavos: number;
}
export interface LimitesAjuste {
  gerente: LimiteAjuste;
  funcionario: LimiteAjuste;
}

/** Quais alertas aparecem no Painel. */
export interface PreferenciasNotificacao {
  falhas: boolean;
  backup: boolean;
  sincronizacao: boolean;
  seguranca: boolean;
  operacao: boolean;
}

/** Backup automático (sobrepõe BACKUP_ATIVO e BACKUP_HORA do .env). */
export interface ConfiguracaoBackup {
  ativo: boolean;
  /** HH:MM no fuso do estacionamento. */
  horario: string;
}

export const CONFIG_PADRAO = {
  estacionamento: {
    nome: 'Estacionamento',
    endereco: null,
    telefone: null,
    horarioFuncionamento: null,
    logo: null,
  } as DadosEstacionamento,
  operacao: {
    vagaAutomatica: true,
    mostrarQrNaEntrada: true,
    confirmarSaida: true,
    alertaPermanenciaHoras: 24,
  } as PreferenciasOperacao,
  seguranca: {
    inatividadeMin: 60,
    duracaoMaxHoras: 12,
    maxTentativas: 5,
    bloqueioMin: 15,
    senhaMinimo: 8,
    senhaExigirMaiuscula: false,
    senhaExigirSimbolo: false,
    somenteRedeLocal: false,
  } as ConfiguracaoSeguranca,
  limitesAjuste: {
    gerente: { percentualMax: 50, valorMaxCentavos: 0 },
    funcionario: { percentualMax: 0, valorMaxCentavos: 0 },
  } as LimitesAjuste,
  notificacoes: {
    falhas: true,
    backup: true,
    sincronizacao: true,
    seguranca: true,
    operacao: true,
  } as PreferenciasNotificacao,
} as const;

export type CategoriaConfig =
  'estacionamento' | 'operacao' | 'seguranca' | 'limitesAjuste' | 'notificacoes' | 'backup';

/** Situação da integração com o servidor externo (somente leitura). */
export interface SituacaoIntegracao {
  configurada: boolean;
  urlApiExterna: string | null;
  urlAppCliente: string | null;
  /** Intervalo de envio da fila (segundos). */
  intervaloEnvioSeg: number | null;
}

/** GET /configuracoes: só as categorias que o usuário pode ver. */
export interface ConfiguracoesGerais {
  estacionamento: DadosEstacionamento;
  operacao: PreferenciasOperacao;
  notificacoes: PreferenciasNotificacao;
  acessoCliente: PoliticaAcessoCliente;
  integracao: SituacaoIntegracao;
  seguranca?: ConfiguracaoSeguranca;
  limitesAjuste?: LimitesAjuste;
  backup?: ConfiguracaoBackup;
  /** Quem alterou cada categoria por último. */
  alteracoes: Record<string, { em: string; por: string | null }>;
}

/** Sessão de login aberta (Configurações → Segurança → Sessões). */
export interface SessaoLoginAtiva {
  id: string;
  usuario: string;
  nome: string;
  ip: string | null;
  navegador: string | null;
  criadaEm: string;
  ultimoUsoEm: string;
  expiraEm: string;
  atual: boolean;
}
