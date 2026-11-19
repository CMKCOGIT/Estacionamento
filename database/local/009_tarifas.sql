-- =============================================================================
-- 009_tarifas.sql — gerenciamento de tarifas
--
-- * Regra de arredondamento: carência por período (hora/fração).
-- * Tarifas especiais na mesma tabela versionada: automáticas (por dia da
--   semana e horário de entrada) ou escolhidas pelo operador (convênio, evento),
--   com preço por tempo ou preço fixo.
-- * Desativar uma regra numa nova versão sem apagar o que valeu antes.
-- * Rastreabilidade: o ticket grava a tarifa aplicada (cópia completa da regra,
--   versão e nome da tabela) na entrada e o cálculo item a item na saída;
--   nenhum dos dois pode ser alterado depois.
-- * Publicação não pode ser retroativa e a tabela vigente não pode ser
--   arquivada (sempre existe um preço valendo).
-- =============================================================================

SET NAMES utf8mb4;

ALTER TABLE tarifa_regras
  ADD COLUMN tipo                VARCHAR(10) NOT NULL DEFAULT 'PADRAO' AFTER categoria_id,
  ADD COLUMN nome                VARCHAR(60) NULL AFTER tipo,
  ADD COLUMN aplicacao           VARCHAR(10) NULL COMMENT 'Especiais: AUTOMATICA ou MANUAL' AFTER nome,
  ADD COLUMN dias_semana         TINYINT UNSIGNED NULL COMMENT 'Bits: 1=dom, 2=seg ... 64=sáb; NULL = todos' AFTER aplicacao,
  ADD COLUMN hora_inicio         TIME NULL COMMENT 'Janela do horário de entrada' AFTER dias_semana,
  ADD COLUMN hora_fim            TIME NULL AFTER hora_inicio,
  ADD COLUMN ativo               BOOLEAN NOT NULL DEFAULT TRUE AFTER hora_fim,
  ADD COLUMN ordem               SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER ativo,
  ADD COLUMN carencia_min        SMALLINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Arredondamento: carência por período' AFTER fracao_centavos,
  ADD COLUMN valor_fixo_centavos INT UNSIGNED NULL COMMENT 'Preço fixo por 24h (especiais)' AFTER diaria_centavos,
  -- Só uma regra PADRÃO por categoria em cada versão; especiais podem ser várias.
  ADD COLUMN categoria_padrao    CHAR(26) CHARACTER SET ascii COLLATE ascii_bin
                                 GENERATED ALWAYS AS (IF(tipo = 'PADRAO', categoria_id, NULL)) STORED,
  ADD KEY ix_regras_tabela (tabela_id),
  ADD CONSTRAINT ck_regras_tipo       CHECK (tipo IN ('PADRAO','ESPECIAL')),
  ADD CONSTRAINT ck_regras_especial   CHECK (tipo = 'PADRAO'
                                          OR (nome IS NOT NULL AND aplicacao IN ('AUTOMATICA','MANUAL'))),
  ADD CONSTRAINT ck_regras_padrao     CHECK (tipo = 'ESPECIAL'
                                          OR (aplicacao IS NULL AND dias_semana IS NULL AND hora_inicio IS NULL
                                              AND valor_fixo_centavos IS NULL)),
  ADD CONSTRAINT ck_regras_dias       CHECK (dias_semana IS NULL OR dias_semana BETWEEN 1 AND 127),
  ADD CONSTRAINT ck_regras_janela     CHECK ((hora_inicio IS NULL) = (hora_fim IS NULL)
                                          AND (hora_inicio IS NULL OR hora_inicio <> hora_fim)),
  ADD CONSTRAINT ck_regras_carencia   CHECK (carencia_min < COALESCE(fracao_min, 60));

ALTER TABLE tarifa_regras
  DROP INDEX uq_regras_categoria,
  ADD UNIQUE KEY uq_regras_padrao (tabela_id, categoria_padrao);

ALTER TABLE sessoes_estacionamento
  ADD COLUMN tarifa_aplicada JSON NULL COMMENT 'Cópia da regra, versão e nome da tabela no momento da entrada' AFTER tarifa_regra_id,
  ADD COLUMN calculo_detalhe JSON NULL COMMENT 'Cálculo item a item gravado na saída' AFTER valor_final_centavos;

DELIMITER $$

-- Tarifa gravada no ticket não muda; o cálculo da saída é gravado uma única vez.
CREATE TRIGGER trg_sessoes_bu_tarifa BEFORE UPDATE ON sessoes_estacionamento FOR EACH ROW FOLLOWS trg_sessoes_bu
BEGIN
  IF COALESCE(@app_retencao, 0) <> 1 THEN
    IF OLD.tarifa_aplicada IS NOT NULL AND NOT (OLD.tarifa_aplicada <=> NEW.tarifa_aplicada) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A tarifa aplicada no ticket não pode ser alterada';
    END IF;
    IF NOT (OLD.tarifa_regra_id <=> NEW.tarifa_regra_id) AND OLD.tarifa_aplicada IS NOT NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A tarifa do ticket é a da entrada e não pode ser trocada';
    END IF;
    IF NEW.status = 'ENCERRADA' AND OLD.tarifa_aplicada IS NOT NULL AND NEW.calculo_detalhe IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Encerramento sem o cálculo detalhado';
    END IF;
  END IF;
END$$

-- Publicação: não retroativa (exceto importação/demonstração) e só com regra padrão ativa.
-- Arquivamento: a tabela vigente não pode ser arquivada.
CREATE TRIGGER trg_tabelas_bu_publicacao BEFORE UPDATE ON tabelas_tarifa FOR EACH ROW FOLLOWS trg_tabelas_bu
BEGIN
  IF OLD.status = 'RASCUNHO' AND NEW.status = 'PUBLICADA' THEN
    IF NEW.vigente_desde < NOW(3) - INTERVAL 1 MINUTE AND COALESCE(@app_retroativo, 0) <> 1 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A vigência não pode começar no passado';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM tarifa_regras WHERE tabela_id = OLD.id AND tipo = 'PADRAO' AND ativo) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A tabela precisa ter ao menos uma tarifa padrão ativa';
    END IF;
  END IF;
  IF OLD.status = 'PUBLICADA' AND NEW.status = 'ARQUIVADA' AND OLD.vigente_desde <= NOW(3)
     AND NOT EXISTS (SELECT 1 FROM tabelas_tarifa t2
                      WHERE t2.site_id = OLD.site_id AND t2.status = 'PUBLICADA' AND t2.id <> OLD.id
                        AND t2.vigente_desde <= NOW(3)
                        AND (t2.vigente_desde > OLD.vigente_desde
                             OR (t2.vigente_desde = OLD.vigente_desde AND t2.versao > OLD.versao))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A tabela vigente não pode ser arquivada: publique uma nova versão';
  END IF;
END$$

-- Histórico: publicação passa a registrar as regras completas (inclui especiais).
DROP TRIGGER trg_tabelas_au$$
CREATE TRIGGER trg_tabelas_au AFTER UPDATE ON tabelas_tarifa FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) THEN
    CALL sp_registrar_historico(NEW.site_id,
      CASE NEW.status WHEN 'PUBLICADA' THEN 'tarifa.publicada' ELSE 'tarifa.arquivada' END,
      'tabelas_tarifa', NEW.id,
      JSON_OBJECT('status', OLD.status),
      JSON_OBJECT('status', NEW.status, 'versao', NEW.versao, 'nome', NEW.nome, 'vigente_desde', NEW.vigente_desde,
                  'regras', (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                'categoria_id', r.categoria_id, 'tipo', r.tipo, 'nome', r.nome,
                                'aplicacao', r.aplicacao, 'dias_semana', r.dias_semana,
                                'hora_inicio', r.hora_inicio, 'hora_fim', r.hora_fim, 'ativo', r.ativo,
                                'tolerancia_min', r.tolerancia_min,
                                'primeira_hora', r.primeira_hora_centavos, 'hora_adicional', r.hora_adicional_centavos,
                                'fracao_min', r.fracao_min, 'fracao', r.fracao_centavos, 'carencia_min', r.carencia_min,
                                'diaria_maxima', r.diaria_maxima_centavos, 'diaria', r.diaria_centavos,
                                'valor_fixo', r.valor_fixo_centavos))
                             FROM tarifa_regras r WHERE r.tabela_id = NEW.id)));
  END IF;
END$$

CREATE TRIGGER trg_tabelas_ai AFTER INSERT ON tabelas_tarifa FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'tarifa.rascunho_criado', 'tabelas_tarifa', NEW.id, NULL,
    JSON_OBJECT('versao', NEW.versao, 'nome', NEW.nome));
END$$

DELIMITER ;
