-- =============================================================================
-- 001_schema.sql — banco da NUVEM (modelo de leitura da API pública)
--
-- Só o que o PWA do cliente precisa mostrar. Não há usuários, operadores,
-- caixa nem dados pessoais além da placa (LGPD, ARQUITETURA §7.5).
-- Os dados chegam do servidor local (sincronização); o servidor local
-- continua sendo a fonte da verdade.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE sites_publicos (
  id               CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  slug             VARCHAR(60)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome             VARCHAR(120) NOT NULL,
  endereco         VARCHAR(255) NULL,
  telefone         VARCHAR(20)  NULL,
  ativo            BOOLEAN      NOT NULL DEFAULT TRUE,
  sincronizado_em  DATETIME(3)  NULL COMMENT 'Último envio do servidor local',
  PRIMARY KEY (id),
  UNIQUE KEY uq_sites_publicos_slug (slug),
  CONSTRAINT ck_sites_publicos_slug CHECK (slug REGEXP '^[a-z0-9]+(-[a-z0-9]+)*$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE disponibilidade_publica (
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria_id   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria      VARCHAR(60) NOT NULL,
  ordem          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  total          INT UNSIGNED NOT NULL,
  livres         INT UNSIGNED NOT NULL,
  atualizado_em  DATETIME(3) NOT NULL,
  PRIMARY KEY (site_id, categoria_id),
  CONSTRAINT fk_disp_site FOREIGN KEY (site_id) REFERENCES sites_publicos (id),
  CONSTRAINT ck_disp_livres CHECK (livres <= total)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tarifas_publicas (
  id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Regra de tarifa',
  site_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria      VARCHAR(60) NOT NULL,
  ordem          SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  nome           VARCHAR(60) NOT NULL,
  especial       BOOLEAN     NOT NULL DEFAULT FALSE,
  condicao       VARCHAR(120) NULL,
  linhas         JSON        NOT NULL COMMENT 'Textos prontos para exibir',
  vigente_desde  DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_tarifas_site (site_id, ordem),
  CONSTRAINT fk_tarifas_site FOREIGN KEY (site_id) REFERENCES sites_publicos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE tickets_publicos (
  id                    CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Mesmo id do ticket no servidor local',
  site_id               CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  numero                BIGINT UNSIGNED NOT NULL,
  placa                 VARCHAR(10) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  categoria             VARCHAR(60) NOT NULL,
  vaga                  VARCHAR(20) NULL,
  modalidade            VARCHAR(10) NOT NULL,
  situacao              VARCHAR(12) NOT NULL,
  entrada_em            DATETIME(3) NOT NULL,
  saida_em              DATETIME(3) NULL,
  regra                 JSON        NOT NULL COMMENT 'Tarifa gravada no ticket na entrada (cálculo do valor acumulado)',
  tarifa_descricao      VARCHAR(255) NOT NULL,
  valor_final_centavos  INT UNSIGNED NULL,
  itens_final           JSON        NULL,
  pago_centavos         INT UNSIGNED NOT NULL DEFAULT 0,
  acesso_expira_em      DATETIME(3) NULL COMMENT '24h após a saída',
  sincronizado_em       DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_tickets_site (site_id, situacao),
  KEY ix_tickets_expira (acesso_expira_em),
  CONSTRAINT fk_tickets_site FOREIGN KEY (site_id) REFERENCES sites_publicos (id),
  CONSTRAINT ck_tickets_situacao CHECK (situacao IN ('ESTACIONADO','ENCERRADO','CANCELADO')),
  CONSTRAINT ck_tickets_modalidade CHECK (modalidade IN ('AVULSO','DIARIA'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Só o HASH do token do link (o token em si nunca sai do celular do cliente).
CREATE TABLE tickets_tokens (
  token_hash   BINARY(32)  NOT NULL,
  ticket_id    CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revogado_em  DATETIME(3) NULL COMMENT 'Novo link gerado ou ticket cancelado',
  PRIMARY KEY (token_hash),
  KEY ix_tokens_ticket (ticket_id),
  CONSTRAINT fk_tokens_ticket FOREIGN KEY (ticket_id) REFERENCES tickets_publicos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
