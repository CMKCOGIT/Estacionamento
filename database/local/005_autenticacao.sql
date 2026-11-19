-- =============================================================================
-- 005_autenticacao.sql — sessões de login do painel administrativo
--
-- O token de sessão é aleatório (32 bytes), fica num cookie httpOnly no
-- navegador e SOMENTE o hash SHA-256 é guardado aqui. Encerrar a sessão
-- (logout, troca de senha, usuário desativado) vale imediatamente.
-- As linhas não são apagadas no encerramento: servem de histórico de acesso.
-- =============================================================================

SET NAMES utf8mb4;

CREATE TABLE sessoes_acesso (
  id                   CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  usuario_id           CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id              CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  token_hash           BINARY(32)   NOT NULL,
  criado_em            DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  ultimo_uso_em        DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  expira_em            DATETIME(3)  NOT NULL COMMENT 'Limite absoluto (ex.: 12h = um turno)',
  ip                   VARCHAR(45)  CHARACTER SET ascii COLLATE ascii_bin NULL,
  user_agent           VARCHAR(255) NULL,
  posto_id             CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  encerrada_em         DATETIME(3)  NULL,
  motivo_encerramento  VARCHAR(20)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessoes_acesso_token (token_hash),
  KEY ix_sessoes_acesso_usuario (usuario_id, encerrada_em),
  KEY ix_sessoes_acesso_limpeza (encerrada_em, expira_em),
  CONSTRAINT fk_sessoes_acesso_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_sessoes_acesso_site    FOREIGN KEY (site_id)    REFERENCES sites (id),
  CONSTRAINT fk_sessoes_acesso_posto   FOREIGN KEY (posto_id)   REFERENCES postos (id),
  CONSTRAINT ck_sessoes_acesso_validade CHECK (expira_em > criado_em),
  CONSTRAINT ck_sessoes_acesso_motivo  CHECK (
        (encerrada_em IS NULL AND motivo_encerramento IS NULL)
     OR (encerrada_em IS NOT NULL AND motivo_encerramento IN
          ('LOGOUT','EXPIRADA','INATIVIDADE','SENHA_ALTERADA','USUARIO_DESATIVADO','REVOGADA')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Sessões de login do painel (somente o hash do token)';

-- Permissão para administrar sessões de outros usuários (derrubar acesso).
INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('usuario.sessoes', 'acesso', 'Ver e encerrar sessões de outros usuários')
AS novo
ON DUPLICATE KEY UPDATE descricao = novo.descricao;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
VALUES ('00000000000000000000000001', 'usuario.sessoes');
