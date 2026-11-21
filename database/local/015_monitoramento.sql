-- =============================================================================
-- 015 — Monitoramento técnico
--
-- erros_sistema: erros internos da API e do processo (5xx, exceções), com a
-- mensagem já sem dados pessoais. Alimenta "Erros recentes" no painel de
-- monitoramento. Guardados por 30 dias.
-- =============================================================================

INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('sistema.monitorar', 'sistema', 'Ver o monitoramento técnico (servidor, banco, internet, nuvem, erros)')
AS novo
ON DUPLICATE KEY UPDATE descricao = novo.descricao;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
VALUES ('00000000000000000000000001', 'sistema.monitorar');

CREATE TABLE erros_sistema (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ocorrido_em    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  origem         VARCHAR(12)  NOT NULL COMMENT 'API | PROCESSO',
  codigo         VARCHAR(40)  NULL,
  mensagem       VARCHAR(1000) NOT NULL,
  metodo         VARCHAR(7)   NULL,
  rota           VARCHAR(200) NULL COMMENT 'Sem query string',
  requisicao_id  VARCHAR(64)  NULL,
  PRIMARY KEY (id),
  KEY ix_erros_data (ocorrido_em)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Erros internos recentes (monitoramento)';
