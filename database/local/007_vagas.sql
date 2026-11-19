-- =============================================================================
-- 007_vagas.sql — gerenciamento de vagas
--
-- * Bloqueio manual registra quem bloqueou, quando e por quê.
-- * Código da vaga normalizado (maiúsculas, letras/números/hífen).
-- * Categoria com vagas em uso não pode ser desativada.
-- =============================================================================

SET NAMES utf8mb4;

-- Vagas já em manutenção antes desta versão recebem um registro de bloqueio.
ALTER TABLE vagas
  ADD COLUMN motivo_bloqueio VARCHAR(255) NULL AFTER observacao,
  ADD COLUMN bloqueada_em    DATETIME(3)  NULL AFTER motivo_bloqueio,
  ADD COLUMN bloqueada_por   CHAR(26) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER bloqueada_em,
  ADD CONSTRAINT fk_vagas_bloqueada_por FOREIGN KEY (bloqueada_por) REFERENCES usuarios (id);

UPDATE vagas
   SET bloqueada_em = atualizado_em, motivo_bloqueio = COALESCE(motivo_bloqueio, 'Manutenção')
 WHERE situacao = 'MANUTENCAO' AND bloqueada_em IS NULL;

UPDATE vagas SET codigo = UPPER(TRIM(codigo)) WHERE codigo <> UPPER(TRIM(codigo));

ALTER TABLE vagas
  ADD CONSTRAINT ck_vagas_bloqueio CHECK (
        (situacao =  'MANUTENCAO' AND bloqueada_em IS NOT NULL AND motivo_bloqueio IS NOT NULL)
     OR (situacao <> 'MANUTENCAO' AND bloqueada_em IS NULL AND motivo_bloqueio IS NULL AND bloqueada_por IS NULL)),
  ADD CONSTRAINT ck_vagas_codigo CHECK (codigo REGEXP '^[A-Z0-9][A-Z0-9-]{0,19}$');

-- Índice para o mapa de vagas (ordenado por setor e código).
CREATE INDEX ix_vagas_mapa ON vagas (site_id, setor, codigo);

DELIMITER $$

CREATE TRIGGER trg_categorias_bu BEFORE UPDATE ON categorias_veiculo FOR EACH ROW
BEGIN
  IF OLD.ativo = TRUE AND NEW.ativo = FALSE
     AND EXISTS (SELECT 1 FROM vagas WHERE categoria_id = OLD.id AND situacao <> 'INATIVA') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Remova ou mude de categoria as vagas antes de desativar esta categoria';
  END IF;
END$$

CREATE TRIGGER trg_categorias_ai AFTER INSERT ON categorias_veiculo FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'categoria.criada', 'categorias_veiculo', NEW.id, NULL,
    JSON_OBJECT('codigo', NEW.codigo, 'nome', NEW.nome));
END$$

CREATE TRIGGER trg_categorias_au AFTER UPDATE ON categorias_veiculo FOR EACH ROW
BEGIN
  IF NOT (OLD.nome <=> NEW.nome) OR NOT (OLD.ativo <=> NEW.ativo) THEN
    CALL sp_registrar_historico(NEW.site_id, 'categoria.alterada', 'categorias_veiculo', NEW.id,
      JSON_OBJECT('nome', OLD.nome, 'ativo', OLD.ativo), JSON_OBJECT('nome', NEW.nome, 'ativo', NEW.ativo));
  END IF;
END$$

-- Capacidade alterada: entra no histórico geral (a tabela própria guarda os detalhes).
CREATE TRIGGER trg_capacidade_ai AFTER INSERT ON capacidade_alteracoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'vaga.capacidade_alterada', 'capacidade_alteracoes', NEW.id,
    JSON_OBJECT('categoria_id', NEW.categoria_id, 'capacidade', NEW.capacidade_anterior),
    JSON_OBJECT('categoria_id', NEW.categoria_id, 'capacidade', NEW.capacidade_nova));
END$$

DELIMITER ;
