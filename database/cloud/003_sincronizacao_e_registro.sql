-- =============================================================================
-- 003 — Sincronização servidor local → nuvem, integrações e registro da API
--
--  * integracoes: quem pode ESCREVER na nuvem (hoje só o servidor local de
--    cada estacionamento; preparado para parceiros futuros com escopos).
--    O segredo NÃO fica no banco: é derivado de SYNC_CHAVE_MESTRA + id +
--    versão (trocar a chave = versão + 1; a anterior vale por um período).
--  * sync_aplicados: idempotência por event_id (evento repetido é ignorado).
--  * sync_estado: último seq aplicado e último contato de cada estacionamento.
--  * sync_nonces: contra reenvio de requisições capturadas (replay).
--  * registro_api: requisições relevantes e erros (sem tokens nem IP em claro).
-- =============================================================================

CREATE TABLE integracoes (
  id                    CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id               CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL
    COMMENT 'Estacionamento da credencial (NULL = vincula no primeiro envio)',
  tipo                  VARCHAR(30)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nome                  VARCHAR(120) NOT NULL,
  escopos               JSON         NOT NULL,
  versao_chave          SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  anterior_valida_ate   DATETIME(3)  NULL COMMENT 'Troca de chave: a versão anterior ainda vale até aqui',
  ativo                 BOOLEAN      NOT NULL DEFAULT TRUE,
  criado_em             DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ultimo_uso_em         DATETIME(3)  NULL,
  PRIMARY KEY (id),
  KEY ix_integracoes_site (site_id),
  CONSTRAINT ck_integracoes_tipo CHECK (tipo IN ('SERVIDOR_LOCAL', 'PARCEIRO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_aplicados (
  event_id     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id      CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  seq          BIGINT UNSIGNED NOT NULL,
  tipo         VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  resultado    VARCHAR(12) NOT NULL,
  aplicado_em  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (event_id),
  KEY ix_sync_aplicados_limpeza (aplicado_em),
  CONSTRAINT ck_sync_aplicados_resultado CHECK (resultado IN ('APLICADO', 'SUPERADO', 'REJEITADO'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_estado (
  site_id             CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ultimo_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ultimo_contato_em   DATETIME(3) NULL,
  snapshot_id         CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Carga completa em andamento',
  ultimo_snapshot_em  DATETIME(3) NULL,
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE sync_nonces (
  integracao_id  CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  nonce          CHAR(32)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  recebido_em    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (integracao_id, nonce),
  KEY ix_sync_nonces_limpeza (recebido_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE registro_api (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ocorrido_em    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  nivel          VARCHAR(5)   CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo           VARCHAR(40)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'ex.: sync.lote, auth.recusada, erro.interno',
  metodo         VARCHAR(7)   CHARACTER SET ascii COLLATE ascii_bin NULL,
  rota           VARCHAR(120) NULL COMMENT 'Sem query string',
  status         SMALLINT UNSIGNED NULL,
  requisicao_id  CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  integracao_id  CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  site_id        CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  ip_hash        CHAR(16)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'HMAC do IP (LGPD: nunca o IP em claro)',
  detalhes       JSON         NULL,
  PRIMARY KEY (id),
  KEY ix_registro_tipo (tipo, ocorrido_em),
  KEY ix_registro_limpeza (ocorrido_em),
  CONSTRAINT ck_registro_nivel CHECK (nivel IN ('info', 'warn', 'error'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Versão aplicada de cada item (um evento atrasado nunca desfaz um mais novo)
ALTER TABLE sites_publicos ADD COLUMN seq_aplicado BIGINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE disponibilidade_publica ADD COLUMN seq_aplicado BIGINT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE tickets_publicos
  ADD COLUMN seq_aplicado BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN snapshot_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- Tarifas por TABELA (versão): a publicada com data futura só passa a valer na data
ALTER TABLE tarifas_publicas
  ADD COLUMN tabela_id CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER site_id,
  ADD COLUMN tabela_versao INT UNSIGNED NOT NULL DEFAULT 0 AFTER tabela_id,
  ADD COLUMN seq_aplicado BIGINT UNSIGNED NOT NULL DEFAULT 0;
CREATE INDEX ix_tarifas_tabela ON tarifas_publicas (site_id, tabela_id);
