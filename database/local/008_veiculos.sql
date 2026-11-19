-- =============================================================================
-- 008_veiculos.sql — gerenciamento de veículos
--
-- * Observações no cadastro do veículo.
-- * Ticket sempre ligado ao veículo certo: a placa copiada na sessão precisa
--   ser a placa do veículo, do mesmo estacionamento.
-- * primeira/última visita mantidas pelo próprio banco a cada entrada.
-- * Histórico de cadastro e alterações (inclusive correção de placa: os
--   tickets antigos continuam com a placa registrada na época).
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE veiculos
  ADD COLUMN observacoes VARCHAR(500) NULL AFTER cor,
  ADD COLUMN criado_por CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER ultima_visita_em,
  ADD CONSTRAINT fk_veiculos_criado_por FOREIGN KEY (criado_por) REFERENCES usuarios (id);

-- Busca por marca/modelo na tela de veículos.
CREATE INDEX ix_veiculos_modelo ON veiculos (site_id, marca, modelo);

DELIMITER $$

-- A sessão precisa apontar para um veículo do mesmo site, com a mesma placa.
CREATE TRIGGER trg_sessoes_bi_veiculo BEFORE INSERT ON sessoes_estacionamento FOR EACH ROW FOLLOWS trg_sessoes_bi
BEGIN
  DECLARE v_placa VARCHAR(10);
  DECLARE v_site CHAR(26);
  SELECT placa, site_id INTO v_placa, v_site FROM veiculos WHERE id = NEW.veiculo_id;
  IF v_site IS NULL OR v_site <> NEW.site_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Veículo não pertence a este estacionamento';
  END IF;
  IF v_placa <> NEW.placa THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A placa do ticket não corresponde à placa do veículo';
  END IF;
END$$

-- Cada entrada atualiza a primeira e a última visita do veículo.
CREATE TRIGGER trg_sessoes_ai_visita AFTER INSERT ON sessoes_estacionamento FOR EACH ROW FOLLOWS trg_sessoes_ai
BEGIN
  UPDATE veiculos
     SET primeira_visita_em = LEAST(COALESCE(primeira_visita_em, NEW.entrada_em), NEW.entrada_em),
         ultima_visita_em   = GREATEST(COALESCE(ultima_visita_em, NEW.entrada_em), NEW.entrada_em)
   WHERE id = NEW.veiculo_id;
END$$

-- Placa corrigida numa sessão aberta: o veículo do ticket deve continuar coerente.
CREATE TRIGGER trg_sessoes_bu_veiculo BEFORE UPDATE ON sessoes_estacionamento FOR EACH ROW FOLLOWS trg_sessoes_bu
BEGIN
  IF COALESCE(@app_retencao, 0) <> 1
     AND (NOT (NEW.veiculo_id <=> OLD.veiculo_id) OR NOT (NEW.placa <=> OLD.placa))
     AND NEW.placa <> (SELECT placa FROM veiculos WHERE id = NEW.veiculo_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A placa do ticket não corresponde à placa do veículo';
  END IF;
END$$

CREATE TRIGGER trg_veiculos_ai AFTER INSERT ON veiculos FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'veiculo.cadastrado', 'veiculos', NEW.id, NULL,
    JSON_OBJECT('placa', NEW.placa, 'categoria_id', NEW.categoria_id, 'marca', NEW.marca, 'modelo', NEW.modelo, 'cor', NEW.cor));
END$$

CREATE TRIGGER trg_veiculos_au AFTER UPDATE ON veiculos FOR EACH ROW
BEGIN
  -- Só alterações de cadastro (as visitas mudam a cada entrada e não poluem o histórico)
  IF NOT (OLD.placa <=> NEW.placa) OR NOT (OLD.placa_estrangeira <=> NEW.placa_estrangeira)
     OR NOT (OLD.categoria_id <=> NEW.categoria_id) OR NOT (OLD.marca <=> NEW.marca)
     OR NOT (OLD.modelo <=> NEW.modelo) OR NOT (OLD.cor <=> NEW.cor) OR NOT (OLD.observacoes <=> NEW.observacoes) THEN
    CALL sp_registrar_historico(NEW.site_id,
      IF(NOT (OLD.placa <=> NEW.placa), 'veiculo.placa_corrigida', 'veiculo.alterado'),
      'veiculos', NEW.id,
      JSON_OBJECT('placa', OLD.placa, 'categoria_id', OLD.categoria_id, 'marca', OLD.marca, 'modelo', OLD.modelo, 'cor', OLD.cor, 'observacoes', OLD.observacoes),
      JSON_OBJECT('placa', NEW.placa, 'categoria_id', NEW.categoria_id, 'marca', NEW.marca, 'modelo', NEW.modelo, 'cor', NEW.cor, 'observacoes', NEW.observacoes));
  END IF;
END$$

DELIMITER ;
