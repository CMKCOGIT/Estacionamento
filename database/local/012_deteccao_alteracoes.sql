-- =============================================================================
-- 012 — Detecção de alterações no próprio banco (rede de segurança da sync)
--
-- Os serviços do servidor local gravam um evento na sync_outbox junto com
-- cada alteração. Estes triggers garantem que NENHUMA alteração relevante
-- para a nuvem passe despercebida, mesmo feita por fora da aplicação (script,
-- correção manual no banco, importação, código futuro que esqueça o evento):
-- cada mudança marca o item em sync_marcas, na mesma transação.
--
-- Quando o serviço grava o evento, ele apaga a marca (o evento já cobre).
-- Marca que sobra = alteração sem evento: o worker de sincronização gera o
-- evento com o estado atual e a apaga.
-- =============================================================================

CREATE TABLE sync_marcas (
  tipo          VARCHAR(20) CHARACTER SET ascii COLLATE ascii_bin NOT NULL
    COMMENT 'ticket | disponibilidade | tabela_tarifa | site',
  agregado_id   CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id       CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  marcado_em    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  alteracoes    INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (tipo, agregado_id),
  KEY ix_sync_marcas_site (site_id, marcado_em),
  CONSTRAINT ck_sync_marcas_tipo CHECK (tipo IN ('ticket', 'disponibilidade', 'tabela_tarifa', 'site'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Itens alterados ainda sem evento de sincronização';

-- Resultado de cada evento na nuvem e rastreio de cada envio
ALTER TABLE sync_outbox
  ADD COLUMN resultado_nuvem VARCHAR(12) NULL COMMENT 'APLICADO | REPETIDO | SUPERADO | REJEITADO' AFTER status,
  ADD COLUMN origem VARCHAR(12) NOT NULL DEFAULT 'APLICACAO' COMMENT 'APLICACAO | DETECCAO | CONFERENCIA' AFTER versao;

ALTER TABLE sync_execucoes
  DROP CHECK ck_sync_exec_tipo,
  MODIFY COLUMN tipo VARCHAR(12) NOT NULL,
  ADD COLUMN requisicao_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL COMMENT 'X-Request-Id da nuvem (o mesmo no registro de lá)',
  ADD COLUMN detalhes JSON NULL,
  ADD CONSTRAINT ck_sync_exec_tipo CHECK (tipo IN ('PUSH', 'PULL', 'ACK', 'SNAPSHOT', 'CONFERENCIA'));

ALTER TABLE sync_estado
  ADD COLUMN ultima_conferencia_em DATETIME(3) NULL,
  ADD COLUMN ultima_conferencia_divergencias INT UNSIGNED NULL,
  ADD COLUMN conferencia_pendente BOOLEAN NOT NULL DEFAULT FALSE;

DELIMITER $$

CREATE PROCEDURE sp_sync_marcar(IN p_tipo VARCHAR(20), IN p_id CHAR(26), IN p_site CHAR(26))
BEGIN
  IF p_id IS NOT NULL AND p_site IS NOT NULL THEN
    INSERT INTO sync_marcas (tipo, agregado_id, site_id) VALUES (p_tipo, p_id, p_site)
    ON DUPLICATE KEY UPDATE marcado_em = CURRENT_TIMESTAMP(3), alteracoes = alteracoes + 1;
  END IF;
END$$

-- Tickets: qualquer mudança no ticket. (A ocupação das vagas NÃO é marcada aqui:
-- seria uma linha disputada por todas as entradas ao mesmo tempo. O worker
-- confere a disponibilidade a cada sinal de vida e envia se mudou.)
CREATE TRIGGER trg_sync_sessoes_ai AFTER INSERT ON sessoes_estacionamento FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.id, NEW.site_id)$$

CREATE TRIGGER trg_sync_sessoes_au AFTER UPDATE ON sessoes_estacionamento FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.id, NEW.site_id)$$

CREATE TRIGGER trg_sync_tokens_ai AFTER INSERT ON sessao_tokens FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.sessao_id, (SELECT site_id FROM sessoes_estacionamento WHERE id = NEW.sessao_id))$$

CREATE TRIGGER trg_sync_tokens_au AFTER UPDATE ON sessao_tokens FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.sessao_id, (SELECT site_id FROM sessoes_estacionamento WHERE id = NEW.sessao_id))$$

-- Pagamentos: só o total pago do ticket vai para a nuvem
CREATE TRIGGER trg_sync_pag_ai AFTER INSERT ON pagamentos FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.sessao_id, NEW.site_id)$$

CREATE TRIGGER trg_sync_pag_au AFTER UPDATE ON pagamentos FOR EACH ROW
  CALL sp_sync_marcar('ticket', NEW.sessao_id, NEW.site_id)$$

-- Vagas e categorias: disponibilidade
CREATE TRIGGER trg_sync_vagas_ai AFTER INSERT ON vagas FOR EACH ROW
  CALL sp_sync_marcar('disponibilidade', NEW.site_id, NEW.site_id)$$

CREATE TRIGGER trg_sync_vagas_au AFTER UPDATE ON vagas FOR EACH ROW
  CALL sp_sync_marcar('disponibilidade', NEW.site_id, NEW.site_id)$$

CREATE TRIGGER trg_sync_vagas_ad AFTER DELETE ON vagas FOR EACH ROW
  CALL sp_sync_marcar('disponibilidade', OLD.site_id, OLD.site_id)$$

CREATE TRIGGER trg_sync_categorias_ai AFTER INSERT ON categorias_veiculo FOR EACH ROW
  CALL sp_sync_marcar('disponibilidade', NEW.site_id, NEW.site_id)$$

CREATE TRIGGER trg_sync_categorias_au AFTER UPDATE ON categorias_veiculo FOR EACH ROW
  CALL sp_sync_marcar('disponibilidade', NEW.site_id, NEW.site_id)$$

-- Tabelas de tarifa: publicação e arquivamento (rascunho não interessa à nuvem)
CREATE TRIGGER trg_sync_tabelas_au AFTER UPDATE ON tabelas_tarifa FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) OR (NEW.status = 'PUBLICADA' AND NOT (OLD.vigente_desde <=> NEW.vigente_desde)) THEN
    CALL sp_sync_marcar('tabela_tarifa', NEW.id, NEW.site_id);
  END IF;
END$$

-- Estacionamento e política do link do cliente
CREATE TRIGGER trg_sync_sites_au AFTER UPDATE ON sites FOR EACH ROW
BEGIN
  IF NOT (OLD.slug <=> NEW.slug) OR NOT (OLD.nome <=> NEW.nome) OR NOT (OLD.endereco <=> NEW.endereco)
     OR NOT (OLD.telefone <=> NEW.telefone) THEN
    CALL sp_sync_marcar('site', NEW.id, NEW.id);
  END IF;
END$$

CREATE TRIGGER trg_sync_config_ai AFTER INSERT ON configuracoes FOR EACH ROW
BEGIN
  IF NEW.chave = 'acesso_cliente' THEN CALL sp_sync_marcar('site', NEW.site_id, NEW.site_id); END IF;
END$$

CREATE TRIGGER trg_sync_config_au AFTER UPDATE ON configuracoes FOR EACH ROW
BEGIN
  IF NEW.chave = 'acesso_cliente' THEN CALL sp_sync_marcar('site', NEW.site_id, NEW.site_id); END IF;
END$$

DELIMITER ;
