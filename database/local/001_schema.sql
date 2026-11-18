-- =============================================================================
-- Sistema de Estacionamento — Banco LOCAL (MySQL 8.4)
-- 001_schema.sql — tabelas, chaves, restrições e índices
--
-- Convenções:
--   * IDs: ULID (CHAR(26), ascii_bin) gerados pela aplicação — ordenáveis no
--     tempo e únicos globalmente (necessário para sincronização e multi-site).
--   * Datas: DATETIME(3) sempre em UTC (a conexão usa time_zone = '+00:00').
--   * Dinheiro: INT UNSIGNED em centavos (nunca FLOAT/DECIMAL).
--   * Estados: VARCHAR + CHECK (mudam pouco). Catálogos que podem crescer
--     (formas de pagamento, permissões, categorias) são tabelas.
--   * Nada referenciado é apagado: cadastros usam ativo/desativado_em e as FKs
--     usam RESTRICT (padrão).
-- =============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- -----------------------------------------------------------------------------
-- 1. ESTABELECIMENTO E CONFIGURAÇÃO
-- -----------------------------------------------------------------------------

CREATE TABLE sites (
  id             CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug           VARCHAR(60)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome           VARCHAR(120) NOT NULL,
  documento      VARCHAR(14)  NULL COMMENT 'CNPJ somente dígitos',
  endereco       VARCHAR(255) NULL,
  telefone       VARCHAR(20)  NULL,
  fuso_horario   VARCHAR(40)  NOT NULL DEFAULT 'America/Sao_Paulo',
  ativo          BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_sites_slug (slug),
  CONSTRAINT ck_sites_slug      CHECK (slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT ck_sites_documento CHECK (documento IS NULL OR documento REGEXP '^[0-9]{14}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Estabelecimentos (1 na v1; preparado para vários)';

-- Contadores sequenciais por site (ex.: número legível do ticket).
-- Uso: SELECT ... FOR UPDATE dentro da mesma transação da inserção.
CREATE TABLE sequencias (
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome           VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  proximo_valor  BIGINT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (site_id, nome),
  CONSTRAINT fk_sequencias_site FOREIGN KEY (site_id) REFERENCES sites (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 2. USUÁRIOS, FUNCIONÁRIOS E PERMISSÕES
-- -----------------------------------------------------------------------------

CREATE TABLE usuarios (
  id                  CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  login               VARCHAR(60)  NOT NULL,
  email               VARCHAR(160) NULL,
  senha_hash          VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'argon2id (formato PHC)',
  ativo               BOOLEAN      NOT NULL DEFAULT TRUE,
  deve_trocar_senha   BOOLEAN      NOT NULL DEFAULT TRUE,
  tentativas_falhas   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_ate       DATETIME(3)  NULL,
  ultimo_login_em     DATETIME(3)  NULL,
  senha_alterada_em   DATETIME(3)  NULL,
  criado_em           DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  desativado_em       DATETIME(3)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_login (login),
  UNIQUE KEY uq_usuarios_email (email),
  CONSTRAINT ck_usuarios_login CHECK (login REGEXP '^[a-z0-9._-]{3,60}$'),
  CONSTRAINT ck_usuarios_ativo CHECK (ativo = TRUE OR desativado_em IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Contas de acesso ao painel (credenciais)';

CREATE TABLE funcionarios (
  id                 CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id            CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id         CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Funcionário pode não ter acesso ao sistema',
  nome               VARCHAR(120) NOT NULL,
  cpf                CHAR(11)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  telefone           VARCHAR(20)  NULL,
  email              VARCHAR(160) NULL,
  cargo              VARCHAR(80)  NULL,
  data_admissao      DATE         NULL,
  data_desligamento  DATE         NULL,
  ativo              BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em          DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_funcionarios_usuario (usuario_id),
  UNIQUE KEY uq_funcionarios_cpf (site_id, cpf),
  KEY ix_funcionarios_nome (site_id, nome),
  CONSTRAINT fk_funcionarios_site    FOREIGN KEY (site_id)    REFERENCES sites (id),
  CONSTRAINT fk_funcionarios_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT ck_funcionarios_cpf     CHECK (cpf IS NULL OR cpf REGEXP '^[0-9]{11}$'),
  CONSTRAINT ck_funcionarios_datas   CHECK (data_desligamento IS NULL OR data_admissao IS NULL OR data_desligamento >= data_admissao)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Dados da pessoa/funcionário (separado da credencial)';

CREATE TABLE permissoes (
  codigo     VARCHAR(60)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ex.: sessao.entrada',
  modulo     VARCHAR(40)  NOT NULL,
  descricao  VARCHAR(255) NOT NULL,
  PRIMARY KEY (codigo),
  KEY ix_permissoes_modulo (modulo),
  CONSTRAINT ck_permissoes_codigo CHECK (codigo REGEXP '^[a-z_]+\\.[a-z_]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Catálogo de permissões (novas permissões = INSERT, sem ALTER)';

CREATE TABLE perfis (
  id          CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  codigo      VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome        VARCHAR(80)  NOT NULL,
  descricao   VARCHAR(255) NULL,
  sistema     BOOLEAN      NOT NULL DEFAULT FALSE COMMENT 'Perfis padrão não podem ser excluídos',
  ativo       BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_perfis_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Papéis (RBAC): admin, operador, financeiro...';

CREATE TABLE perfil_permissoes (
  perfil_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permissao_codigo  VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (perfil_id, permissao_codigo),
  KEY ix_perfil_permissoes_permissao (permissao_codigo),
  CONSTRAINT fk_pp_perfil    FOREIGN KEY (perfil_id)        REFERENCES perfis (id),
  CONSTRAINT fk_pp_permissao FOREIGN KEY (permissao_codigo) REFERENCES permissoes (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Perfil do usuário em CADA site (permite um usuário em vários estabelecimentos).
CREATE TABLE usuario_perfis (
  usuario_id     CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id        CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  perfil_id      CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  concedido_por  CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL,
  concedido_em   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id, site_id, perfil_id),
  KEY ix_up_site (site_id),
  KEY ix_up_perfil (perfil_id),
  CONSTRAINT fk_up_usuario   FOREIGN KEY (usuario_id)    REFERENCES usuarios (id),
  CONSTRAINT fk_up_site      FOREIGN KEY (site_id)       REFERENCES sites (id),
  CONSTRAINT fk_up_perfil    FOREIGN KEY (perfil_id)     REFERENCES perfis (id),
  CONSTRAINT fk_up_concedido FOREIGN KEY (concedido_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Configurações chave/valor por site (política de retenção, prazos, etc.).
CREATE TABLE configuracoes (
  site_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  chave           VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  valor           JSON        NOT NULL,
  descricao       VARCHAR(255) NULL,
  atualizado_por  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  atualizado_em   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id, chave),
  CONSTRAINT fk_config_site    FOREIGN KEY (site_id)        REFERENCES sites (id),
  CONSTRAINT fk_config_usuario FOREIGN KEY (atualizado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Estações de trabalho (caixa, entrada, monitor do cliente). Necessário para
-- caixa por posto e para a "Tela do Cliente" saber qual QR exibir.
CREATE TABLE postos (
  id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome           VARCHAR(60) NOT NULL,
  tipo           VARCHAR(20) NOT NULL DEFAULT 'GUICHE',
  ativo          BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_postos_nome (site_id, nome),
  CONSTRAINT fk_postos_site FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_postos_tipo CHECK (tipo IN ('GUICHE','ENTRADA','SAIDA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 3. VAGAS E CAPACIDADE
-- -----------------------------------------------------------------------------

CREATE TABLE categorias_veiculo (
  id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  codigo         VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'CARRO, MOTO, ...',
  nome           VARCHAR(60) NOT NULL,
  ordem          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  ativo          BOOLEAN     NOT NULL DEFAULT TRUE,
  criado_em      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_categorias_codigo (site_id, codigo),
  CONSTRAINT fk_categorias_site   FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_categorias_codigo CHECK (codigo REGEXP '^[A-Z][A-Z0-9_]*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Cada vaga física. Capacidade = vagas ATIVA + MANUTENCAO; disponível = ATIVA
-- sem sessão aberta. Alterar capacidade = criar ou inativar vagas (nunca apagar
-- vaga já usada).
CREATE TABLE vagas (
  id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  codigo         VARCHAR(20) NOT NULL COMMENT 'Identificação visível, ex.: A-01',
  setor          VARCHAR(40) NULL,
  categoria_id   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  situacao       VARCHAR(12) NOT NULL DEFAULT 'ATIVA',
  coberta        BOOLEAN     NOT NULL DEFAULT FALSE,
  observacao     VARCHAR(255) NULL,
  criado_em      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  desativada_em  DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_vagas_codigo (site_id, codigo),
  KEY ix_vagas_disponibilidade (site_id, categoria_id, situacao),
  CONSTRAINT fk_vagas_site      FOREIGN KEY (site_id)      REFERENCES sites (id),
  CONSTRAINT fk_vagas_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_veiculo (id),
  CONSTRAINT ck_vagas_situacao  CHECK (situacao IN ('ATIVA','MANUTENCAO','INATIVA')),
  CONSTRAINT ck_vagas_inativa   CHECK ((situacao = 'INATIVA') = (desativada_em IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Histórico explícito de mudanças de capacidade feitas pelo administrador.
CREATE TABLE capacidade_alteracoes (
  id                   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id              CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  capacidade_anterior  INT UNSIGNED NOT NULL,
  capacidade_nova      INT UNSIGNED NOT NULL,
  vagas_afetadas       JSON        NOT NULL COMMENT 'IDs das vagas criadas/inativadas/reativadas',
  motivo               VARCHAR(255) NOT NULL,
  alterado_por         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  alterado_em          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_capacidade_site_data (site_id, alterado_em),
  KEY ix_capacidade_categoria (categoria_id),
  CONSTRAINT fk_capacidade_site      FOREIGN KEY (site_id)      REFERENCES sites (id),
  CONSTRAINT fk_capacidade_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_veiculo (id),
  CONSTRAINT fk_capacidade_usuario   FOREIGN KEY (alterado_por) REFERENCES usuarios (id),
  CONSTRAINT ck_capacidade_mudou     CHECK (capacidade_anterior <> capacidade_nova)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 4. CLIENTES E VEÍCULOS
-- -----------------------------------------------------------------------------

-- Opcional na v1 (cliente avulso não precisa de cadastro). Base para mensalistas.
CREATE TABLE clientes (
  id              CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id         CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo_pessoa     CHAR(2)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'PF',
  nome            VARCHAR(120) NOT NULL,
  documento       VARCHAR(14)  CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'CPF/CNPJ somente dígitos',
  telefone        VARCHAR(20)  NULL,
  email           VARCHAR(160) NULL,
  observacoes     VARCHAR(500) NULL,
  ativo           BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  anonimizado_em  DATETIME(3)  NULL COMMENT 'LGPD: dados pessoais removidos',
  PRIMARY KEY (id),
  UNIQUE KEY uq_clientes_documento (site_id, documento),
  KEY ix_clientes_nome (site_id, nome),
  CONSTRAINT fk_clientes_site  FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_clientes_tipo  CHECK (tipo_pessoa IN ('PF','PJ')),
  CONSTRAINT ck_clientes_doc   CHECK (documento IS NULL
                                   OR (tipo_pessoa = 'PF' AND documento REGEXP '^[0-9]{11}$')
                                   OR (tipo_pessoa = 'PJ' AND documento REGEXP '^[0-9]{14}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Placa armazenada normalizada: maiúsculas, sem hífen/espaço.
-- Aceita padrão antigo (ABC1234) e Mercosul (ABC1D23); placas estrangeiras
-- são permitidas com a flag placa_estrangeira.
CREATE TABLE veiculos (
  id                  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  placa               VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  placa_estrangeira   BOOLEAN     NOT NULL DEFAULT FALSE,
  categoria_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  marca               VARCHAR(40) NULL,
  modelo              VARCHAR(60) NULL,
  cor                 VARCHAR(30) NULL,
  primeira_visita_em  DATETIME(3) NULL,
  ultima_visita_em    DATETIME(3) NULL,
  criado_em           DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em       DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_veiculos_placa (site_id, placa),
  KEY ix_veiculos_ultima_visita (site_id, ultima_visita_em),
  CONSTRAINT fk_veiculos_site      FOREIGN KEY (site_id)      REFERENCES sites (id),
  CONSTRAINT fk_veiculos_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_veiculo (id),
  CONSTRAINT ck_veiculos_placa CHECK (
        (placa_estrangeira = FALSE AND placa REGEXP '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$')
     OR (placa_estrangeira = TRUE  AND placa REGEXP '^[A-Z0-9]{4,10}$'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- N:N — um cliente pode ter vários veículos e um veículo vários responsáveis.
CREATE TABLE cliente_veiculos (
  cliente_id     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  veiculo_id     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  principal      BOOLEAN     NOT NULL DEFAULT FALSE,
  vinculado_em   DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (cliente_id, veiculo_id),
  KEY ix_cv_veiculo (veiculo_id),
  CONSTRAINT fk_cv_cliente FOREIGN KEY (cliente_id) REFERENCES clientes (id),
  CONSTRAINT fk_cv_veiculo FOREIGN KEY (veiculo_id) REFERENCES veiculos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 5. TARIFAS (versionadas e imutáveis após publicação)
-- -----------------------------------------------------------------------------

CREATE TABLE tabelas_tarifa (
  id             CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id        CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  versao         INT UNSIGNED NOT NULL,
  nome           VARCHAR(80)  NOT NULL,
  descricao      VARCHAR(255) NULL,
  status         VARCHAR(10)  NOT NULL DEFAULT 'RASCUNHO',
  vigente_desde  DATETIME(3)  NULL,
  criado_por     CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  publicado_por  CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  publicado_em   DATETIME(3)  NULL,
  arquivado_em   DATETIME(3)  NULL,
  criado_em      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_tabelas_versao (site_id, versao),
  KEY ix_tabelas_vigencia (site_id, status, vigente_desde),
  CONSTRAINT fk_tabelas_site      FOREIGN KEY (site_id)       REFERENCES sites (id),
  CONSTRAINT fk_tabelas_criador   FOREIGN KEY (criado_por)    REFERENCES usuarios (id),
  CONSTRAINT fk_tabelas_publicador FOREIGN KEY (publicado_por) REFERENCES usuarios (id),
  CONSTRAINT ck_tabelas_status    CHECK (status IN ('RASCUNHO','PUBLICADA','ARQUIVADA')),
  CONSTRAINT ck_tabelas_publicacao CHECK (status = 'RASCUNHO'
                                       OR (vigente_desde IS NOT NULL AND publicado_em IS NOT NULL AND publicado_por IS NOT NULL)),
  CONSTRAINT ck_tabelas_arquivo   CHECK ((status = 'ARQUIVADA') = (arquivado_em IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Versão vigente = PUBLICADA com maior vigente_desde <= agora';

CREATE TABLE tarifa_regras (
  id                        CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tabela_id                 CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria_id              CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tolerancia_min            SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  primeira_hora_centavos    INT UNSIGNED NOT NULL,
  hora_adicional_centavos   INT UNSIGNED NOT NULL,
  fracao_min                SMALLINT UNSIGNED NULL,
  fracao_centavos           INT UNSIGNED NULL,
  diaria_maxima_centavos    INT UNSIGNED NULL,
  diaria_centavos           INT UNSIGNED NULL COMMENT 'Preço do modo DIARIA',
  pernoite_inicio           TIME NULL COMMENT 'Futuro',
  pernoite_fim              TIME NULL COMMENT 'Futuro',
  pernoite_centavos         INT UNSIGNED NULL COMMENT 'Futuro',
  parametros_extras         JSON NULL COMMENT 'Regras futuras sem ALTER TABLE',
  criado_em                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_regras_categoria (tabela_id, categoria_id),
  KEY ix_regras_categoria (categoria_id),
  CONSTRAINT fk_regras_tabela    FOREIGN KEY (tabela_id)    REFERENCES tabelas_tarifa (id),
  CONSTRAINT fk_regras_categoria FOREIGN KEY (categoria_id) REFERENCES categorias_veiculo (id),
  CONSTRAINT ck_regras_tolerancia CHECK (tolerancia_min <= 240),
  CONSTRAINT ck_regras_fracao     CHECK ((fracao_min IS NULL AND fracao_centavos IS NULL)
                                      OR (fracao_min BETWEEN 1 AND 59 AND fracao_centavos IS NOT NULL)),
  CONSTRAINT ck_regras_pernoite   CHECK ((pernoite_inicio IS NULL AND pernoite_fim IS NULL AND pernoite_centavos IS NULL)
                                      OR (pernoite_inicio IS NOT NULL AND pernoite_fim IS NOT NULL AND pernoite_centavos IS NOT NULL)),
  CONSTRAINT ck_regras_teto       CHECK (diaria_maxima_centavos IS NULL OR diaria_maxima_centavos >= primeira_hora_centavos)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 6. SESSÕES DE ESTACIONAMENTO (tickets)
-- -----------------------------------------------------------------------------

CREATE TABLE sessoes_estacionamento (
  id                        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id                   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  numero                    BIGINT UNSIGNED NOT NULL COMMENT 'Número legível do ticket (tabela sequencias)',
  veiculo_id                CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  placa                     VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Cópia da placa no momento da entrada',
  categoria_id              CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  vaga_id                   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Obrigatória na v1 (regra da aplicação); nula p/ integrações futuras',
  cliente_id                CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  tarifa_regra_id           CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Versão vigente na entrada',
  modalidade                VARCHAR(10) NOT NULL DEFAULT 'AVULSO',
  status                    VARCHAR(10) NOT NULL DEFAULT 'ABERTA',
  origem_entrada            VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
  entrada_em                DATETIME(3) NOT NULL,
  saida_em                  DATETIME(3) NULL,
  posto_entrada_id          CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  posto_saida_id            CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  operador_entrada_id       CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operador_saida_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  valor_calculado_centavos  INT UNSIGNED NULL,
  desconto_centavos         INT UNSIGNED NOT NULL DEFAULT 0,
  acrescimo_centavos        INT UNSIGNED NOT NULL DEFAULT 0,
  valor_final_centavos      INT UNSIGNED NULL,
  motivo_ajuste             VARCHAR(255) NULL,
  cancelado_por             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  cancelado_em              DATETIME(3) NULL,
  motivo_cancelamento       VARCHAR(255) NULL,
  observacoes               VARCHAR(500) NULL,
  versao                    INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Controle de concorrência otimista',
  criado_em                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  -- Colunas geradas: só têm valor enquanto a sessão está ABERTA. Como índices
  -- UNIQUE aceitam vários NULL, isso garante no banco:
  --   * uma vaga não tem duas sessões abertas;
  --   * um veículo não tem duas sessões abertas.
  vaga_ocupada_id    CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                     GENERATED ALWAYS AS (IF(status = 'ABERTA', vaga_id, NULL)) STORED,
  veiculo_aberto_id  CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                     GENERATED ALWAYS AS (IF(status = 'ABERTA', veiculo_id, NULL)) STORED,

  PRIMARY KEY (id),
  UNIQUE KEY uq_sessoes_numero        (site_id, numero),
  UNIQUE KEY uq_sessoes_vaga_aberta   (vaga_ocupada_id),
  UNIQUE KEY uq_sessoes_veiculo_aberto (veiculo_aberto_id),
  KEY ix_sessoes_status_entrada (site_id, status, entrada_em),
  KEY ix_sessoes_saida          (site_id, saida_em),
  KEY ix_sessoes_placa          (placa, entrada_em),
  KEY ix_sessoes_veiculo        (veiculo_id, entrada_em),
  KEY ix_sessoes_vaga           (vaga_id),
  KEY ix_sessoes_cliente        (cliente_id),
  KEY ix_sessoes_regra          (tarifa_regra_id),
  CONSTRAINT fk_sessoes_site        FOREIGN KEY (site_id)             REFERENCES sites (id),
  CONSTRAINT fk_sessoes_veiculo     FOREIGN KEY (veiculo_id)          REFERENCES veiculos (id),
  CONSTRAINT fk_sessoes_categoria   FOREIGN KEY (categoria_id)        REFERENCES categorias_veiculo (id),
  CONSTRAINT fk_sessoes_vaga        FOREIGN KEY (vaga_id)             REFERENCES vagas (id),
  CONSTRAINT fk_sessoes_cliente     FOREIGN KEY (cliente_id)          REFERENCES clientes (id),
  CONSTRAINT fk_sessoes_regra       FOREIGN KEY (tarifa_regra_id)     REFERENCES tarifa_regras (id),
  CONSTRAINT fk_sessoes_posto_ent   FOREIGN KEY (posto_entrada_id)    REFERENCES postos (id),
  CONSTRAINT fk_sessoes_posto_sai   FOREIGN KEY (posto_saida_id)      REFERENCES postos (id),
  CONSTRAINT fk_sessoes_oper_ent    FOREIGN KEY (operador_entrada_id) REFERENCES usuarios (id),
  CONSTRAINT fk_sessoes_oper_sai    FOREIGN KEY (operador_saida_id)   REFERENCES usuarios (id),
  CONSTRAINT fk_sessoes_cancelador  FOREIGN KEY (cancelado_por)       REFERENCES usuarios (id),
  CONSTRAINT ck_sessoes_modalidade  CHECK (modalidade IN ('AVULSO','DIARIA')),
  CONSTRAINT ck_sessoes_status      CHECK (status IN ('ABERTA','ENCERRADA','CANCELADA')),
  CONSTRAINT ck_sessoes_origem      CHECK (origem_entrada IN ('MANUAL','LPR','SENSOR','IMPORTACAO')),
  CONSTRAINT ck_sessoes_datas       CHECK (saida_em IS NULL OR saida_em >= entrada_em),
  CONSTRAINT ck_sessoes_aberta      CHECK (status <> 'ABERTA' OR (saida_em IS NULL AND valor_final_centavos IS NULL)),
  CONSTRAINT ck_sessoes_encerrada   CHECK (status <> 'ENCERRADA'
                                        OR (saida_em IS NOT NULL AND operador_saida_id IS NOT NULL
                                            AND valor_calculado_centavos IS NOT NULL AND valor_final_centavos IS NOT NULL)),
  CONSTRAINT ck_sessoes_cancelada   CHECK (status <> 'CANCELADA'
                                        OR (cancelado_em IS NOT NULL AND cancelado_por IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  CONSTRAINT ck_sessoes_valor_final CHECK (valor_final_centavos IS NULL
                                        OR valor_final_centavos = CAST(valor_calculado_centavos AS SIGNED)
                                                                  - CAST(desconto_centavos AS SIGNED)
                                                                  + CAST(acrescimo_centavos AS SIGNED)),
  CONSTRAINT ck_sessoes_ajuste      CHECK ((desconto_centavos = 0 AND acrescimo_centavos = 0) OR motivo_ajuste IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Ticket: entrada -> saída de um veículo';

-- Tokens de acesso do cliente (link/QR). Só o hash SHA-256 é guardado.
-- Revogar = marcar revogado_em e criar outro; o histórico fica preservado.
CREATE TABLE sessao_tokens (
  id                CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sessao_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash        BINARY(32)  NOT NULL,
  criado_por        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  criado_em         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_em         DATETIME(3) NULL COMMENT 'Definido na saída (+24h)',
  revogado_em       DATETIME(3) NULL,
  revogado_por      CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  motivo_revogacao  VARCHAR(255) NULL,
  token_ativo_sessao CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                     GENERATED ALWAYS AS (IF(revogado_em IS NULL, sessao_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tokens_hash         (token_hash),
  UNIQUE KEY uq_tokens_ativo_sessao (token_ativo_sessao),
  KEY ix_tokens_sessao (sessao_id),
  CONSTRAINT fk_tokens_sessao   FOREIGN KEY (sessao_id)    REFERENCES sessoes_estacionamento (id),
  CONSTRAINT fk_tokens_criador  FOREIGN KEY (criado_por)   REFERENCES usuarios (id),
  CONSTRAINT fk_tokens_revogador FOREIGN KEY (revogado_por) REFERENCES usuarios (id),
  CONSTRAINT ck_tokens_revogacao CHECK ((revogado_em IS NULL AND revogado_por IS NULL)
                                     OR (revogado_em IS NOT NULL AND revogado_por IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 7. CAIXA, PAGAMENTOS E MOVIMENTAÇÕES FINANCEIRAS
-- -----------------------------------------------------------------------------

CREATE TABLE formas_pagamento (
  codigo             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome               VARCHAR(60) NOT NULL,
  permite_troco      BOOLEAN     NOT NULL DEFAULT FALSE,
  exige_autorizacao  BOOLEAN     NOT NULL DEFAULT FALSE COMMENT 'Pede NSU/código da maquininha',
  permite_parcelas   BOOLEAN     NOT NULL DEFAULT FALSE,
  ativo              BOOLEAN     NOT NULL DEFAULT TRUE,
  ordem              SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (codigo),
  CONSTRAINT ck_formas_codigo CHECK (codigo REGEXP '^[A-Z][A-Z0-9_]*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Nova forma (ex.: PIX_ONLINE, VALE) = INSERT';

-- Turno de caixa de um operador em um posto.
CREATE TABLE caixa_sessoes (
  id                        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id                   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  posto_id                  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  operador_id               CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status                    VARCHAR(8)  NOT NULL DEFAULT 'ABERTO',
  aberto_em                 DATETIME(3) NOT NULL,
  fechado_em                DATETIME(3) NULL,
  fechado_por               CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  saldo_inicial_centavos    INT UNSIGNED NOT NULL DEFAULT 0,
  saldo_esperado_centavos   INT UNSIGNED NULL COMMENT 'Dinheiro calculado no fechamento',
  saldo_contado_centavos    INT UNSIGNED NULL COMMENT 'Dinheiro contado pelo operador',
  diferenca_centavos        INT          NULL COMMENT 'contado - esperado (pode ser negativo)',
  observacao_fechamento     VARCHAR(500) NULL,
  criado_em                 DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  atualizado_em             DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  posto_aberto_id     CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                      GENERATED ALWAYS AS (IF(status = 'ABERTO', posto_id, NULL)) STORED,
  operador_aberto_id  CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                      GENERATED ALWAYS AS (IF(status = 'ABERTO', operador_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_caixa_posto_aberto    (posto_aberto_id),
  UNIQUE KEY uq_caixa_operador_aberto (operador_aberto_id),
  KEY ix_caixa_site_abertura (site_id, aberto_em),
  KEY ix_caixa_operador      (operador_id, aberto_em),
  KEY ix_caixa_posto         (posto_id),
  CONSTRAINT fk_caixa_site     FOREIGN KEY (site_id)     REFERENCES sites (id),
  CONSTRAINT fk_caixa_posto    FOREIGN KEY (posto_id)    REFERENCES postos (id),
  CONSTRAINT fk_caixa_operador FOREIGN KEY (operador_id) REFERENCES usuarios (id),
  CONSTRAINT fk_caixa_fechador FOREIGN KEY (fechado_por) REFERENCES usuarios (id),
  CONSTRAINT ck_caixa_status   CHECK (status IN ('ABERTO','FECHADO')),
  CONSTRAINT ck_caixa_fechado  CHECK ((status = 'ABERTO'  AND fechado_em IS NULL AND fechado_por IS NULL)
                                   OR (status = 'FECHADO' AND fechado_em IS NOT NULL AND fechado_por IS NOT NULL
                                       AND saldo_esperado_centavos IS NOT NULL AND saldo_contado_centavos IS NOT NULL
                                       AND diferenca_centavos IS NOT NULL)),
  CONSTRAINT ck_caixa_datas    CHECK (fechado_em IS NULL OR fechado_em >= aberto_em),
  CONSTRAINT ck_caixa_diferenca CHECK (diferenca_centavos IS NULL
                                    OR diferenca_centavos = CAST(saldo_contado_centavos AS SIGNED) - CAST(saldo_esperado_centavos AS SIGNED))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Um ticket pode ter vários pagamentos (pagamento dividido).
-- Nunca é apagado nem alterado; a única mudança permitida é o estorno.
CREATE TABLE pagamentos (
  id                       CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id                  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sessao_id                CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caixa_sessao_id          CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Obrigatório se PRESENCIAL',
  forma_codigo             VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  origem                   VARCHAR(10) NOT NULL DEFAULT 'PRESENCIAL',
  valor_centavos           INT UNSIGNED NOT NULL COMMENT 'Valor abatido da conta',
  valor_recebido_centavos  INT UNSIGNED NULL COMMENT 'Somente dinheiro: valor entregue',
  troco_centavos           INT UNSIGNED NOT NULL DEFAULT 0,
  autorizacao              VARCHAR(40) NULL COMMENT 'NSU / código de autorização / ID Pix',
  bandeira                 VARCHAR(30) NULL,
  parcelas                 TINYINT UNSIGNED NOT NULL DEFAULT 1,
  status                   VARCHAR(10) NOT NULL DEFAULT 'CONFIRMADO',
  chave_idempotencia       CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'UUID gerado pela tela: evita pagamento duplicado por duplo clique/reenvio',
  registrado_por           CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registrado_em            DATETIME(3) NOT NULL,
  estornado_por            CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  estornado_em             DATETIME(3) NULL,
  motivo_estorno           VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_pagamentos_idempotencia (chave_idempotencia),
  KEY ix_pagamentos_sessao (sessao_id),
  KEY ix_pagamentos_caixa  (caixa_sessao_id),
  KEY ix_pagamentos_data   (site_id, registrado_em),
  KEY ix_pagamentos_forma  (forma_codigo, registrado_em),
  CONSTRAINT fk_pag_site      FOREIGN KEY (site_id)         REFERENCES sites (id),
  CONSTRAINT fk_pag_sessao    FOREIGN KEY (sessao_id)       REFERENCES sessoes_estacionamento (id),
  CONSTRAINT fk_pag_caixa     FOREIGN KEY (caixa_sessao_id) REFERENCES caixa_sessoes (id),
  CONSTRAINT fk_pag_forma     FOREIGN KEY (forma_codigo)    REFERENCES formas_pagamento (codigo),
  CONSTRAINT fk_pag_registro  FOREIGN KEY (registrado_por)  REFERENCES usuarios (id),
  CONSTRAINT fk_pag_estorno   FOREIGN KEY (estornado_por)   REFERENCES usuarios (id),
  CONSTRAINT ck_pag_origem    CHECK (origem IN ('PRESENCIAL','ONLINE')),
  CONSTRAINT ck_pag_caixa     CHECK (origem = 'ONLINE' OR caixa_sessao_id IS NOT NULL),
  CONSTRAINT ck_pag_valor     CHECK (valor_centavos > 0),
  CONSTRAINT ck_pag_troco     CHECK ((valor_recebido_centavos IS NULL AND troco_centavos = 0)
                                  OR (valor_recebido_centavos >= valor_centavos
                                      AND troco_centavos = CAST(valor_recebido_centavos AS SIGNED) - CAST(valor_centavos AS SIGNED))),
  CONSTRAINT ck_pag_parcelas  CHECK (parcelas BETWEEN 1 AND 24),
  CONSTRAINT ck_pag_status    CHECK (status IN ('CONFIRMADO','ESTORNADO')),
  CONSTRAINT ck_pag_estorno   CHECK ((status = 'CONFIRMADO' AND estornado_em IS NULL AND estornado_por IS NULL AND motivo_estorno IS NULL)
                                  OR (status = 'ESTORNADO'  AND estornado_em IS NOT NULL AND estornado_por IS NOT NULL AND motivo_estorno IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Livro-caixa: toda entrada/saída de dinheiro. Somente inserção (append-only).
CREATE TABLE movimentacoes_financeiras (
  id               CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id          CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caixa_sessao_id  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  tipo             VARCHAR(12) NOT NULL,
  direcao          VARCHAR(7)  NOT NULL,
  valor_centavos   INT UNSIGNED NOT NULL,
  forma_codigo     VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  pagamento_id     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  sessao_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  descricao        VARCHAR(255) NULL,
  registrado_por   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registrado_em    DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_mov_pagamento_tipo (pagamento_id, tipo) COMMENT 'Um recebimento e no máximo um estorno por pagamento',
  KEY ix_mov_caixa  (caixa_sessao_id, tipo),
  KEY ix_mov_data   (site_id, registrado_em),
  KEY ix_mov_sessao (sessao_id),
  KEY ix_mov_forma  (forma_codigo),
  CONSTRAINT fk_mov_site      FOREIGN KEY (site_id)         REFERENCES sites (id),
  CONSTRAINT fk_mov_caixa     FOREIGN KEY (caixa_sessao_id) REFERENCES caixa_sessoes (id),
  CONSTRAINT fk_mov_forma     FOREIGN KEY (forma_codigo)    REFERENCES formas_pagamento (codigo),
  CONSTRAINT fk_mov_pagamento FOREIGN KEY (pagamento_id)    REFERENCES pagamentos (id),
  CONSTRAINT fk_mov_sessao    FOREIGN KEY (sessao_id)       REFERENCES sessoes_estacionamento (id),
  CONSTRAINT fk_mov_usuario   FOREIGN KEY (registrado_por)  REFERENCES usuarios (id),
  CONSTRAINT ck_mov_valor     CHECK (valor_centavos > 0),
  CONSTRAINT ck_mov_direcao   CHECK (direcao IN ('ENTRADA','SAIDA')),
  CONSTRAINT ck_mov_tipo      CHECK (
        (tipo = 'ABERTURA'    AND direcao = 'ENTRADA' AND pagamento_id IS NULL)
     OR (tipo = 'SUPRIMENTO'  AND direcao = 'ENTRADA' AND pagamento_id IS NULL)
     OR (tipo = 'SANGRIA'     AND direcao = 'SAIDA'   AND pagamento_id IS NULL)
     OR (tipo = 'RECEBIMENTO' AND direcao = 'ENTRADA' AND pagamento_id IS NOT NULL)
     OR (tipo = 'ESTORNO'     AND direcao = 'SAIDA'   AND pagamento_id IS NOT NULL)
     OR (tipo = 'AJUSTE'      AND descricao IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 8. HISTÓRICO DE ATIVIDADES (auditoria — append-only)
-- -----------------------------------------------------------------------------

CREATE TABLE historico_atividades (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id           CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  usuario_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'NULL = sistema',
  acao              VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ex.: sessao.cancelada',
  entidade          VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NULL,
  entidade_id       VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  dados_anteriores  JSON        NULL,
  dados_novos       JSON        NULL,
  motivo            VARCHAR(255) NULL,
  origem            VARCHAR(10) NOT NULL DEFAULT 'APP' COMMENT 'APP (serviço) ou DB (trigger)',
  ip                VARCHAR(45) CHARACTER SET ascii COLLATE ascii_bin NULL,
  posto_id          CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  correlacao_id     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'ID da requisição',
  criado_em         DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_hist_entidade (entidade, entidade_id, criado_em),
  KEY ix_hist_usuario  (usuario_id, criado_em),
  KEY ix_hist_acao     (acao, criado_em),
  KEY ix_hist_data     (site_id, criado_em),
  CONSTRAINT ck_hist_origem CHECK (origem IN ('APP','DB'))
  -- Sem FKs de propósito: o histórico deve sobreviver a qualquer mudança
  -- nos cadastros e ser gravado mesmo em falhas parciais.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 9. SINCRONIZAÇÃO COM A NUVEM
-- -----------------------------------------------------------------------------

-- Fila de eventos gravada na MESMA transação da alteração de negócio.
CREATE TABLE sync_outbox (
  seq                  BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id              CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo                 VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ex.: ticket.aberto',
  versao               SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  agregado_tipo        VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  agregado_id          CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  payload              JSON        NOT NULL,
  ocorrido_em          DATETIME(3) NOT NULL,
  status               VARCHAR(10) NOT NULL DEFAULT 'PENDENTE',
  tentativas           SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  proxima_tentativa_em DATETIME(3) NULL,
  ultimo_erro          VARCHAR(1000) NULL,
  enviado_em           DATETIME(3) NULL,
  criado_em            DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (seq),
  UNIQUE KEY uq_outbox_event (event_id),
  KEY ix_outbox_pendentes (status, seq),
  KEY ix_outbox_site_seq  (site_id, seq),
  KEY ix_outbox_agregado  (agregado_tipo, agregado_id),
  KEY ix_outbox_limpeza   (status, enviado_em),
  CONSTRAINT fk_outbox_site   FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_outbox_status CHECK (status IN ('PENDENTE','ENVIADO','REJEITADO')),
  CONSTRAINT ck_outbox_envio  CHECK (status = 'PENDENTE' OR enviado_em IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Estado da sincronização por site (o que a nuvem já confirmou).
CREATE TABLE sync_estado (
  site_id                CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ultimo_seq_confirmado  BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_push_em         DATETIME(3) NULL,
  ultimo_sucesso_em      DATETIME(3) NULL,
  ultimo_erro_em         DATETIME(3) NULL,
  ultimo_erro            VARCHAR(1000) NULL,
  ultimo_snapshot_em     DATETIME(3) NULL,
  cursor_inbox           VARCHAR(100) CHARACTER SET ascii COLLATE ascii_bin NULL,
  atualizado_em          DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id),
  CONSTRAINT fk_sync_estado_site FOREIGN KEY (site_id) REFERENCES sites (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Itens criados na nuvem para o local processar (futuro: mensalista, Pix).
CREATE TABLE sync_inbox (
  id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ID gerado na nuvem (idempotência)',
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo           VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  versao         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  payload        JSON        NOT NULL,
  criado_na_nuvem_em DATETIME(3) NOT NULL,
  recebido_em    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  status         VARCHAR(10) NOT NULL DEFAULT 'PENDENTE',
  tentativas     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  processado_em  DATETIME(3) NULL,
  resultado      JSON        NULL,
  ultimo_erro    VARCHAR(1000) NULL,
  confirmado_em  DATETIME(3) NULL COMMENT 'ACK enviado para a nuvem',
  PRIMARY KEY (id),
  KEY ix_inbox_pendentes (status, recebido_em),
  CONSTRAINT fk_inbox_site   FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_inbox_status CHECK (status IN ('PENDENTE','PROCESSADO','REJEITADO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Registro de cada execução do worker (diagnóstico e tela de status).
CREATE TABLE sync_execucoes (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id           CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo              VARCHAR(10) NOT NULL,
  iniciado_em       DATETIME(3) NOT NULL,
  finalizado_em     DATETIME(3) NULL,
  sucesso           BOOLEAN     NULL,
  itens             INT UNSIGNED NOT NULL DEFAULT 0,
  primeiro_seq      BIGINT UNSIGNED NULL,
  ultimo_seq        BIGINT UNSIGNED NULL,
  http_status       SMALLINT UNSIGNED NULL,
  duracao_ms        INT UNSIGNED NULL,
  erro              VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY ix_sync_exec_data (site_id, iniciado_em),
  KEY ix_sync_exec_falhas (sucesso, iniciado_em),
  CONSTRAINT fk_sync_exec_site FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_sync_exec_tipo CHECK (tipo IN ('PUSH','PULL','ACK','SNAPSHOT'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
