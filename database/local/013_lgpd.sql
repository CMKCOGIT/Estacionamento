-- =============================================================================
-- 013 — LGPD: atendimento aos titulares e retenção
--
--  * permissão lgpd.atender (relatório/portabilidade/anonimização e registro
--    das solicitações dos titulares) — só administradores por padrão;
--  * lgpd_solicitacoes: protocolo, tipo (art. 18), prazo de 15 dias (art. 19),
--    situação e resposta. O identificador do titular é apagado depois da
--    conclusão (fica só o hash, para provar o atendimento);
--  * a rotina de retenção/anonimização (@app_retencao = 1) pode redigir o
--    histórico: a anonimização apaga a placa também das trilhas de auditoria.
-- =============================================================================

INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('lgpd.atender', 'sistema', 'Atender solicitações de titulares (LGPD): relatório, exportação e anonimização')
AS novo
ON DUPLICATE KEY UPDATE descricao = novo.descricao;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
VALUES ('00000000000000000000000001', 'lgpd.atender');

CREATE TABLE lgpd_solicitacoes (
  id                  CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id             CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  protocolo           VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  tipo                VARCHAR(30)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  titular_nome        VARCHAR(120) NULL,
  titular_contato     VARCHAR(160) NULL,
  identificador       VARCHAR(20)  CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'Placa informada (apagada após a conclusão)',
  identificador_hash  CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'SHA-256 da placa (prova do atendimento)',
  descricao           VARCHAR(1000) NULL,
  status              VARCHAR(15)  NOT NULL DEFAULT 'ABERTA',
  recebida_em         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  prazo_em            DATETIME(3)  NOT NULL,
  concluida_em        DATETIME(3)  NULL,
  resposta            VARCHAR(2000) NULL,
  registrada_por      CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  concluida_por       CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  dados_removidos_em  DATETIME(3)  NULL COMMENT 'Identificação do titular apagada pela retenção',
  atualizado_em       DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_lgpd_protocolo (site_id, protocolo),
  KEY ix_lgpd_status (site_id, status, prazo_em),
  CONSTRAINT fk_lgpd_site FOREIGN KEY (site_id) REFERENCES sites (id),
  CONSTRAINT ck_lgpd_tipo CHECK (tipo IN ('CONFIRMACAO_ACESSO', 'CORRECAO', 'ANONIMIZACAO_ELIMINACAO', 'PORTABILIDADE',
                                          'INFORMACAO_COMPARTILHAMENTO', 'REVOGACAO_CONSENTIMENTO', 'OPOSICAO')),
  CONSTRAINT ck_lgpd_status CHECK (status IN ('ABERTA', 'EM_ANDAMENTO', 'ATENDIDA', 'INDEFERIDA')),
  CONSTRAINT ck_lgpd_conclusao CHECK ((status IN ('ATENDIDA', 'INDEFERIDA')) = (concluida_em IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Solicitações de titulares de dados (LGPD art. 18)';

DROP TRIGGER trg_historico_bu;

DELIMITER $$

-- Histórico: somente inserção, exceto a redação de dados pessoais pela rotina de anonimização
CREATE TRIGGER trg_historico_bu BEFORE UPDATE ON historico_atividades FOR EACH ROW
BEGIN
  IF COALESCE(@app_retencao, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'historico_atividades é somente inserção';
  END IF;
  IF NOT (OLD.acao <=> NEW.acao) OR NOT (OLD.criado_em <=> NEW.criado_em) OR NOT (OLD.usuario_id <=> NEW.usuario_id)
     OR NOT (OLD.entidade_id <=> NEW.entidade_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A anonimização só pode redigir os dados, não alterar a trilha';
  END IF;
END$$

-- Solicitações: concluída não volta a ser aberta
CREATE TRIGGER trg_lgpd_bu BEFORE UPDATE ON lgpd_solicitacoes FOR EACH ROW
BEGIN
  IF OLD.status IN ('ATENDIDA', 'INDEFERIDA') AND NOT (OLD.status <=> NEW.status) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Solicitação concluída não pode ser reaberta: registre uma nova';
  END IF;
END$$

CREATE TRIGGER trg_lgpd_ai AFTER INSERT ON lgpd_solicitacoes FOR EACH ROW
  CALL sp_registrar_historico(NEW.site_id, 'lgpd.solicitacao_registrada', 'lgpd_solicitacoes', NEW.id, NULL,
    JSON_OBJECT('protocolo', NEW.protocolo, 'tipo', NEW.tipo, 'prazo_em', NEW.prazo_em))$$

CREATE TRIGGER trg_lgpd_au AFTER UPDATE ON lgpd_solicitacoes FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) THEN
    CALL sp_registrar_historico(NEW.site_id, 'lgpd.solicitacao_atualizada', 'lgpd_solicitacoes', NEW.id,
      JSON_OBJECT('status', OLD.status), JSON_OBJECT('status', NEW.status, 'protocolo', NEW.protocolo));
  END IF;
END$$

DELIMITER ;
