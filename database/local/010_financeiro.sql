-- =============================================================================
-- 010_financeiro.sql — pagamentos e fechamento de caixa
--
-- * Estorno só com o ticket ABERTO: a conta de um ticket encerrado (soma dos
--   pagamentos = valor final) nunca fica inconsistente.
-- * Estorno sai do caixa aberto de quem estorna (movimentação ESTORNO).
-- * Sangria e suprimento registrados no histórico de atividades.
-- * Índices para as consultas do módulo financeiro.
-- =============================================================================

SET NAMES utf8mb4;

-- Consultas por período e status (lista de pagamentos, resumo diário)
CREATE INDEX ix_pagamentos_status_data ON pagamentos (site_id, status, registrado_em);
CREATE INDEX ix_pagamentos_estorno ON pagamentos (site_id, estornado_em);
CREATE INDEX ix_mov_tipo_data ON movimentacoes_financeiras (site_id, tipo, registrado_em);

DELIMITER $$

CREATE TRIGGER trg_pag_bu_sessao BEFORE UPDATE ON pagamentos FOR EACH ROW FOLLOWS trg_pag_bu
BEGIN
  IF NEW.status = 'ESTORNADO' AND OLD.status = 'CONFIRMADO'
     AND (SELECT status FROM sessoes_estacionamento WHERE id = OLD.sessao_id) <> 'ABERTA'
     AND COALESCE(@app_retencao, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pagamento de ticket encerrado não pode ser estornado';
  END IF;
END$$

-- Estorno precisa sair de um caixa: a movimentação ESTORNO existe para cada pagamento estornado
CREATE TRIGGER trg_mov_bi_estorno BEFORE INSERT ON movimentacoes_financeiras FOR EACH ROW FOLLOWS trg_mov_bi
BEGIN
  IF NEW.tipo IN ('RECEBIMENTO', 'ESTORNO') THEN
    IF NOT EXISTS (SELECT 1 FROM pagamentos p
                    WHERE p.id = NEW.pagamento_id AND p.valor_centavos = NEW.valor_centavos
                      AND p.forma_codigo = NEW.forma_codigo AND p.site_id = NEW.site_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movimentação não confere com o pagamento (valor, forma ou site)';
    END IF;
  END IF;
  IF NEW.tipo IN ('ABERTURA', 'SANGRIA', 'SUPRIMENTO') AND NEW.forma_codigo <> 'DINHEIRO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Abertura, sangria e suprimento são sempre em dinheiro';
  END IF;
END$$

CREATE TRIGGER trg_mov_ai AFTER INSERT ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  IF NEW.tipo IN ('SANGRIA', 'SUPRIMENTO') THEN
    CALL sp_registrar_historico(NEW.site_id, CONCAT('caixa.', LOWER(NEW.tipo)), 'movimentacoes_financeiras', NEW.id, NULL,
      JSON_OBJECT('caixa_sessao_id', NEW.caixa_sessao_id, 'valor', NEW.valor_centavos, 'descricao', NEW.descricao));
  END IF;
END$$

DELIMITER ;
