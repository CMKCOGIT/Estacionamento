-- =============================================================================
-- 014 — Backups do banco local
--
-- Histórico de cada backup (e de cada falha). O mesmo dado também fica num
-- manifesto .json ao lado de cada arquivo: se o banco se perder, a pasta de
-- backups sozinha basta para saber o que restaurar (docs/BACKUP.md).
-- =============================================================================

INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('backup.gerenciar', 'sistema', 'Ver, criar e verificar backups do banco de dados')
AS novo
ON DUPLICATE KEY UPDATE descricao = novo.descricao;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
VALUES ('00000000000000000000000001', 'backup.gerenciar');

CREATE TABLE backups (
  id                CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo              VARCHAR(12)  NOT NULL COMMENT 'AUTOMATICO | MANUAL',
  status            VARCHAR(12)  NOT NULL COMMENT 'EM_ANDAMENTO | SUCESSO | FALHA',
  iniciado_em       DATETIME(3)  NOT NULL,
  concluido_em      DATETIME(3)  NULL,
  duracao_ms        INT UNSIGNED NULL,
  arquivo           VARCHAR(255) NULL COMMENT 'Nome do arquivo na pasta de backups',
  tamanho_bytes     BIGINT UNSIGNED NULL,
  sha256            CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Do arquivo criptografado',
  chave_id          CHAR(16)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Impressão da chave usada',
  tabelas           INT UNSIGNED NULL,
  copia_em          DATETIME(3)  NULL COMMENT 'Segunda cópia gravada em BACKUP_COPIA_DIR',
  verificado_em     DATETIME(3)  NULL,
  verificacao       VARCHAR(12)  NULL COMMENT 'OK | CORROMPIDO | AUSENTE',
  restauracao_testada_em DATETIME(3) NULL,
  removido_em       DATETIME(3)  NULL COMMENT 'Apagado pela política de retenção',
  erro              VARCHAR(1000) NULL,
  solicitado_por    CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  PRIMARY KEY (id),
  KEY ix_backups_data (iniciado_em),
  KEY ix_backups_status (status, iniciado_em),
  CONSTRAINT ck_backups_tipo CHECK (tipo IN ('AUTOMATICO', 'MANUAL')),
  CONSTRAINT ck_backups_status CHECK (status IN ('EM_ANDAMENTO', 'SUCESSO', 'FALHA')),
  CONSTRAINT ck_backups_verificacao CHECK (verificacao IS NULL OR verificacao IN ('OK', 'CORROMPIDO', 'AUSENTE'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Histórico de backups do banco local';
