-- =============================================================================
-- 002_triggers.sql — integridade que CHECK/FK não cobrem + histórico automático
--
-- Variáveis de sessão definidas pela aplicação a cada transação:
--   @app_usuario_id     usuário autenticado (CHAR 26)
--   @app_motivo         justificativa informada (estorno, cancelamento...)
--   @app_posto_id       posto de trabalho
--   @app_correlacao_id  ID da requisição (liga o histórico ao log da API)
--   @app_retencao       = 1 SOMENTE na rotina de retenção/anonimização
--
-- Divisão de responsabilidade do histórico:
--   * TRIGGERS (origem = 'DB'): toda ALTERAÇÃO DE DADOS importante — não há
--     como esquecer de auditar, nem por SQL manual.
--   * APLICAÇÃO (origem = 'APP'): eventos sem alteração de dados (login, falha
--     de login, exibição/reenvio de QR, exportação de relatório).
--
-- Executar com o cliente mysql (usa DELIMITER).
-- =============================================================================

DELIMITER $$

-- -----------------------------------------------------------------------------
-- Procedimento auxiliar de auditoria
-- -----------------------------------------------------------------------------
CREATE PROCEDURE sp_registrar_historico(
  IN p_site_id     CHAR(26),
  IN p_acao        VARCHAR(60),
  IN p_entidade    VARCHAR(60),
  IN p_entidade_id VARCHAR(64),
  IN p_antes       JSON,
  IN p_depois      JSON)
BEGIN
  INSERT INTO historico_atividades
    (site_id, usuario_id, acao, entidade, entidade_id,
     dados_anteriores, dados_novos, motivo, origem, posto_id, correlacao_id)
  VALUES
    (p_site_id, @app_usuario_id, p_acao, p_entidade, p_entidade_id,
     p_antes, p_depois, @app_motivo, 'DB', @app_posto_id, @app_correlacao_id);
END$$

-- -----------------------------------------------------------------------------
-- Histórico e livro-caixa: somente inserção
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_historico_bu BEFORE UPDATE ON historico_atividades FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'historico_atividades é somente inserção';
END$$

CREATE TRIGGER trg_historico_bd BEFORE DELETE ON historico_atividades FOR EACH ROW
BEGIN
  IF COALESCE(@app_retencao, 0) <> 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'historico_atividades só pode ser expurgado pela rotina de retenção';
  END IF;
END$$

CREATE TRIGGER trg_mov_bu BEFORE UPDATE ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movimentação financeira não pode ser alterada; registre um AJUSTE ou ESTORNO';
END$$

CREATE TRIGGER trg_mov_bd BEFORE DELETE ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Movimentação financeira não pode ser excluída';
END$$

CREATE TRIGGER trg_mov_bi BEFORE INSERT ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  IF NEW.caixa_sessao_id IS NOT NULL
     AND (SELECT status FROM caixa_sessoes WHERE id = NEW.caixa_sessao_id) <> 'ABERTO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Caixa fechado: não aceita movimentações';
  END IF;
END$$

CREATE TRIGGER trg_capacidade_bu BEFORE UPDATE ON capacidade_alteracoes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacidade_alteracoes é somente inserção';
END$$

CREATE TRIGGER trg_capacidade_bd BEFORE DELETE ON capacidade_alteracoes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'capacidade_alteracoes é somente inserção';
END$$

-- -----------------------------------------------------------------------------
-- Vagas
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_vagas_bu BEFORE UPDATE ON vagas FOR EACH ROW
BEGIN
  IF (NEW.situacao <> 'ATIVA' OR NOT (NEW.categoria_id <=> OLD.categoria_id))
     AND EXISTS (SELECT 1 FROM sessoes_estacionamento WHERE vaga_ocupada_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vaga ocupada: libere a vaga antes de inativar ou mudar a categoria';
  END IF;
END$$

CREATE TRIGGER trg_vagas_ai AFTER INSERT ON vagas FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'vaga.criada', 'vagas', NEW.id, NULL,
    JSON_OBJECT('codigo', NEW.codigo, 'setor', NEW.setor, 'categoria_id', NEW.categoria_id, 'situacao', NEW.situacao));
END$$

CREATE TRIGGER trg_vagas_au AFTER UPDATE ON vagas FOR EACH ROW
BEGIN
  IF NOT (OLD.codigo <=> NEW.codigo) OR NOT (OLD.setor <=> NEW.setor)
     OR NOT (OLD.categoria_id <=> NEW.categoria_id) OR NOT (OLD.situacao <=> NEW.situacao) THEN
    CALL sp_registrar_historico(NEW.site_id, 'vaga.alterada', 'vagas', NEW.id,
      JSON_OBJECT('codigo', OLD.codigo, 'setor', OLD.setor, 'categoria_id', OLD.categoria_id, 'situacao', OLD.situacao),
      JSON_OBJECT('codigo', NEW.codigo, 'setor', NEW.setor, 'categoria_id', NEW.categoria_id, 'situacao', NEW.situacao));
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- Tarifas: rascunho editável; publicada é imutável (só pode ser arquivada)
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_tabelas_bu BEFORE UPDATE ON tabelas_tarifa FOR EACH ROW
BEGIN
  IF OLD.status = 'ARQUIVADA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tabela de tarifa arquivada não pode ser alterada';
  END IF;

  IF OLD.status = 'PUBLICADA' THEN
    IF NEW.status <> 'ARQUIVADA'
       OR NOT (OLD.versao <=> NEW.versao) OR NOT (OLD.nome <=> NEW.nome)
       OR NOT (OLD.vigente_desde <=> NEW.vigente_desde) OR NOT (OLD.site_id <=> NEW.site_id)
       OR NOT (OLD.publicado_em <=> NEW.publicado_em) OR NOT (OLD.publicado_por <=> NEW.publicado_por) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tabela publicada é imutável: crie uma nova versão';
    END IF;
  END IF;

  IF OLD.status = 'RASCUNHO' AND NEW.status = 'PUBLICADA'
     AND NOT EXISTS (SELECT 1 FROM tarifa_regras WHERE tabela_id = OLD.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tabela sem regras não pode ser publicada';
  END IF;
END$$

CREATE TRIGGER trg_tabelas_bd BEFORE DELETE ON tabelas_tarifa FOR EACH ROW
BEGIN
  IF OLD.status <> 'RASCUNHO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Somente rascunhos de tarifa podem ser excluídos';
  END IF;
END$$

CREATE TRIGGER trg_tabelas_au AFTER UPDATE ON tabelas_tarifa FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) THEN
    CALL sp_registrar_historico(NEW.site_id,
      CASE NEW.status WHEN 'PUBLICADA' THEN 'tarifa.publicada' ELSE 'tarifa.arquivada' END,
      'tabelas_tarifa', NEW.id,
      JSON_OBJECT('status', OLD.status),
      JSON_OBJECT('status', NEW.status, 'versao', NEW.versao, 'vigente_desde', NEW.vigente_desde,
                  'regras', (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                                'categoria_id', r.categoria_id, 'tolerancia_min', r.tolerancia_min,
                                'primeira_hora', r.primeira_hora_centavos, 'hora_adicional', r.hora_adicional_centavos,
                                'fracao_min', r.fracao_min, 'fracao', r.fracao_centavos,
                                'diaria_maxima', r.diaria_maxima_centavos, 'diaria', r.diaria_centavos))
                             FROM tarifa_regras r WHERE r.tabela_id = NEW.id)));
  END IF;
END$$

CREATE TRIGGER trg_regras_bi BEFORE INSERT ON tarifa_regras FOR EACH ROW
BEGIN
  IF (SELECT status FROM tabelas_tarifa WHERE id = NEW.tabela_id) <> 'RASCUNHO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Regras só podem ser incluídas em tabela RASCUNHO';
  END IF;
END$$

CREATE TRIGGER trg_regras_bu BEFORE UPDATE ON tarifa_regras FOR EACH ROW
BEGIN
  IF (SELECT status FROM tabelas_tarifa WHERE id = OLD.tabela_id) <> 'RASCUNHO'
     OR (SELECT status FROM tabelas_tarifa WHERE id = NEW.tabela_id) <> 'RASCUNHO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Regras de tabela publicada são imutáveis';
  END IF;
END$$

CREATE TRIGGER trg_regras_bd BEFORE DELETE ON tarifa_regras FOR EACH ROW
BEGIN
  IF (SELECT status FROM tabelas_tarifa WHERE id = OLD.tabela_id) <> 'RASCUNHO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Regras de tabela publicada não podem ser excluídas';
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- Sessões de estacionamento
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_sessoes_bi BEFORE INSERT ON sessoes_estacionamento FOR EACH ROW
BEGIN
  IF NEW.status <> 'ABERTA' AND NEW.origem_entrada <> 'IMPORTACAO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sessão deve ser criada como ABERTA';
  END IF;
  IF NEW.vaga_id IS NOT NULL
     AND (SELECT situacao FROM vagas WHERE id = NEW.vaga_id) <> 'ATIVA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vaga indisponível (manutenção ou inativa)';
  END IF;
  IF (SELECT t.status FROM tarifa_regras r JOIN tabelas_tarifa t ON t.id = r.tabela_id
      WHERE r.id = NEW.tarifa_regra_id) <> 'PUBLICADA' AND NEW.origem_entrada <> 'IMPORTACAO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A regra de tarifa precisa pertencer a uma tabela PUBLICADA';
  END IF;
END$$

CREATE TRIGGER trg_sessoes_bu BEFORE UPDATE ON sessoes_estacionamento FOR EACH ROW
BEGIN
  IF COALESCE(@app_retencao, 0) <> 1 THEN
    IF OLD.status <> 'ABERTA' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sessão encerrada ou cancelada não pode ser alterada';
    END IF;
    IF NOT (NEW.vaga_id <=> OLD.vaga_id) AND NEW.vaga_id IS NOT NULL
       AND (SELECT situacao FROM vagas WHERE id = NEW.vaga_id) <> 'ATIVA' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Vaga de destino indisponível';
    END IF;
    IF NOT (NEW.numero <=> OLD.numero) OR NOT (NEW.site_id <=> OLD.site_id)
       OR NOT (NEW.operador_entrada_id <=> OLD.operador_entrada_id) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Número, site e operador de entrada são imutáveis';
    END IF;
    -- Só encerra se os pagamentos confirmados cobrem exatamente o valor final.
    IF NEW.status = 'ENCERRADA'
       AND (SELECT COALESCE(SUM(valor_centavos), 0) FROM pagamentos
            WHERE sessao_id = OLD.id AND status = 'CONFIRMADO') <> NEW.valor_final_centavos THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Soma dos pagamentos diferente do valor final da sessão';
    END IF;
  END IF;
  SET NEW.versao = OLD.versao + 1;
END$$

CREATE TRIGGER trg_sessoes_bd BEFORE DELETE ON sessoes_estacionamento FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Sessões não são excluídas; use cancelamento';
END$$

CREATE TRIGGER trg_sessoes_au AFTER UPDATE ON sessoes_estacionamento FOR EACH ROW
BEGIN
  IF NOT (OLD.status <=> NEW.status) OR NOT (OLD.placa <=> NEW.placa) OR NOT (OLD.vaga_id <=> NEW.vaga_id)
     OR NOT (OLD.categoria_id <=> NEW.categoria_id) OR NOT (OLD.entrada_em <=> NEW.entrada_em)
     OR NOT (OLD.tarifa_regra_id <=> NEW.tarifa_regra_id) OR NOT (OLD.modalidade <=> NEW.modalidade)
     OR NOT (OLD.desconto_centavos <=> NEW.desconto_centavos) OR NOT (OLD.acrescimo_centavos <=> NEW.acrescimo_centavos) THEN
    CALL sp_registrar_historico(NEW.site_id,
      CASE
        WHEN COALESCE(@app_retencao, 0) = 1                        THEN 'sessao.anonimizada'
        WHEN NEW.status = 'ENCERRADA' AND OLD.status = 'ABERTA'    THEN 'sessao.encerrada'
        WHEN NEW.status = 'CANCELADA' AND OLD.status = 'ABERTA'    THEN 'sessao.cancelada'
        ELSE 'sessao.alterada'
      END,
      'sessoes_estacionamento', NEW.id,
      JSON_OBJECT('status', OLD.status, 'placa', OLD.placa, 'vaga_id', OLD.vaga_id, 'categoria_id', OLD.categoria_id,
                  'entrada_em', OLD.entrada_em, 'tarifa_regra_id', OLD.tarifa_regra_id, 'modalidade', OLD.modalidade,
                  'desconto', OLD.desconto_centavos, 'acrescimo', OLD.acrescimo_centavos),
      JSON_OBJECT('status', NEW.status, 'placa', NEW.placa, 'vaga_id', NEW.vaga_id, 'categoria_id', NEW.categoria_id,
                  'entrada_em', NEW.entrada_em, 'tarifa_regra_id', NEW.tarifa_regra_id, 'modalidade', NEW.modalidade,
                  'desconto', NEW.desconto_centavos, 'acrescimo', NEW.acrescimo_centavos,
                  'saida_em', NEW.saida_em, 'valor_final', NEW.valor_final_centavos));
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- Tokens de acesso do cliente
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_tokens_bu BEFORE UPDATE ON sessao_tokens FOR EACH ROW
BEGIN
  IF NOT (OLD.token_hash <=> NEW.token_hash) OR NOT (OLD.sessao_id <=> NEW.sessao_id)
     OR NOT (OLD.criado_em <=> NEW.criado_em) OR NOT (OLD.criado_por <=> NEW.criado_por) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Token: apenas expiração e revogação podem mudar';
  END IF;
  IF OLD.revogado_em IS NOT NULL AND NOT (OLD.revogado_em <=> NEW.revogado_em) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Token revogado não pode ser reativado';
  END IF;
END$$

CREATE TRIGGER trg_tokens_bd BEFORE DELETE ON sessao_tokens FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tokens não são excluídos; use revogação';
END$$

CREATE TRIGGER trg_tokens_au AFTER UPDATE ON sessao_tokens FOR EACH ROW
BEGIN
  IF OLD.revogado_em IS NULL AND NEW.revogado_em IS NOT NULL THEN
    CALL sp_registrar_historico(
      (SELECT site_id FROM sessoes_estacionamento WHERE id = NEW.sessao_id),
      'ticket.token_revogado', 'sessao_tokens', NEW.id, NULL,
      JSON_OBJECT('sessao_id', NEW.sessao_id, 'motivo', NEW.motivo_revogacao));
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- Caixa
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_caixa_bu BEFORE UPDATE ON caixa_sessoes FOR EACH ROW
BEGIN
  IF OLD.status = 'FECHADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Caixa fechado não pode ser alterado';
  END IF;
  IF NOT (OLD.saldo_inicial_centavos <=> NEW.saldo_inicial_centavos) OR NOT (OLD.aberto_em <=> NEW.aberto_em)
     OR NOT (OLD.operador_id <=> NEW.operador_id) OR NOT (OLD.posto_id <=> NEW.posto_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Dados de abertura do caixa são imutáveis';
  END IF;
END$$

CREATE TRIGGER trg_caixa_bd BEFORE DELETE ON caixa_sessoes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Caixa não pode ser excluído';
END$$

CREATE TRIGGER trg_caixa_ai AFTER INSERT ON caixa_sessoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'caixa.aberto', 'caixa_sessoes', NEW.id, NULL,
    JSON_OBJECT('posto_id', NEW.posto_id, 'operador_id', NEW.operador_id, 'saldo_inicial', NEW.saldo_inicial_centavos));
END$$

CREATE TRIGGER trg_caixa_au AFTER UPDATE ON caixa_sessoes FOR EACH ROW
BEGIN
  IF OLD.status = 'ABERTO' AND NEW.status = 'FECHADO' THEN
    CALL sp_registrar_historico(NEW.site_id, 'caixa.fechado', 'caixa_sessoes', NEW.id, NULL,
      JSON_OBJECT('esperado', NEW.saldo_esperado_centavos, 'contado', NEW.saldo_contado_centavos,
                  'diferenca', NEW.diferenca_centavos, 'fechado_por', NEW.fechado_por));
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- Pagamentos: imutáveis, exceto a transição CONFIRMADO -> ESTORNADO
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_pag_bi BEFORE INSERT ON pagamentos FOR EACH ROW
BEGIN
  IF NEW.status <> 'CONFIRMADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pagamento deve ser criado como CONFIRMADO';
  END IF;
  IF (SELECT status FROM sessoes_estacionamento WHERE id = NEW.sessao_id) <> 'ABERTA' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pagamento só pode ser registrado em sessão ABERTA';
  END IF;
  IF NEW.caixa_sessao_id IS NOT NULL
     AND (SELECT status FROM caixa_sessoes WHERE id = NEW.caixa_sessao_id) <> 'ABERTO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Caixa fechado: abra um caixa para registrar o pagamento';
  END IF;
  IF NEW.valor_recebido_centavos IS NOT NULL
     AND (SELECT permite_troco FROM formas_pagamento WHERE codigo = NEW.forma_codigo) = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Forma de pagamento não aceita troco';
  END IF;
END$$

CREATE TRIGGER trg_pag_bu BEFORE UPDATE ON pagamentos FOR EACH ROW
BEGIN
  IF OLD.status <> 'CONFIRMADO' OR NEW.status <> 'ESTORNADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pagamento só admite a alteração CONFIRMADO -> ESTORNADO';
  END IF;
  IF NOT (OLD.site_id <=> NEW.site_id) OR NOT (OLD.sessao_id <=> NEW.sessao_id)
     OR NOT (OLD.caixa_sessao_id <=> NEW.caixa_sessao_id) OR NOT (OLD.forma_codigo <=> NEW.forma_codigo)
     OR NOT (OLD.origem <=> NEW.origem) OR NOT (OLD.valor_centavos <=> NEW.valor_centavos)
     OR NOT (OLD.valor_recebido_centavos <=> NEW.valor_recebido_centavos)
     OR NOT (OLD.troco_centavos <=> NEW.troco_centavos) OR NOT (OLD.autorizacao <=> NEW.autorizacao)
     OR NOT (OLD.bandeira <=> NEW.bandeira) OR NOT (OLD.parcelas <=> NEW.parcelas)
     OR NOT (OLD.chave_idempotencia <=> NEW.chave_idempotencia)
     OR NOT (OLD.registrado_por <=> NEW.registrado_por) OR NOT (OLD.registrado_em <=> NEW.registrado_em) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Dados do pagamento são imutáveis';
  END IF;
END$$

CREATE TRIGGER trg_pag_bd BEFORE DELETE ON pagamentos FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Pagamento não pode ser excluído; use estorno';
END$$

CREATE TRIGGER trg_pag_ai AFTER INSERT ON pagamentos FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'pagamento.registrado', 'pagamentos', NEW.id, NULL,
    JSON_OBJECT('sessao_id', NEW.sessao_id, 'forma', NEW.forma_codigo, 'valor', NEW.valor_centavos,
                'recebido', NEW.valor_recebido_centavos, 'troco', NEW.troco_centavos));
END$$

CREATE TRIGGER trg_pag_au AFTER UPDATE ON pagamentos FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'pagamento.estornado', 'pagamentos', NEW.id,
    JSON_OBJECT('status', OLD.status),
    JSON_OBJECT('status', NEW.status, 'valor', NEW.valor_centavos, 'forma', NEW.forma_codigo,
                'motivo', NEW.motivo_estorno, 'estornado_por', NEW.estornado_por));
END$$

-- -----------------------------------------------------------------------------
-- Usuários, perfis, permissões e configurações
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_usuarios_au AFTER UPDATE ON usuarios FOR EACH ROW
BEGIN
  IF NOT (OLD.login <=> NEW.login) OR NOT (OLD.email <=> NEW.email) OR NOT (OLD.ativo <=> NEW.ativo) THEN
    CALL sp_registrar_historico(NULL, 'usuario.alterado', 'usuarios', NEW.id,
      JSON_OBJECT('login', OLD.login, 'email', OLD.email, 'ativo', OLD.ativo),
      JSON_OBJECT('login', NEW.login, 'email', NEW.email, 'ativo', NEW.ativo));
  END IF;
  IF NOT (OLD.senha_hash <=> NEW.senha_hash) THEN
    -- Nunca grava o hash no histórico.
    CALL sp_registrar_historico(NULL, 'usuario.senha_alterada', 'usuarios', NEW.id, NULL, NULL);
  END IF;
  IF OLD.bloqueado_ate IS NULL AND NEW.bloqueado_ate IS NOT NULL THEN
    CALL sp_registrar_historico(NULL, 'usuario.bloqueado', 'usuarios', NEW.id, NULL,
      JSON_OBJECT('bloqueado_ate', NEW.bloqueado_ate, 'tentativas', NEW.tentativas_falhas));
  END IF;
END$$

CREATE TRIGGER trg_up_ai AFTER INSERT ON usuario_perfis FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'usuario.perfil_concedido', 'usuario_perfis',
    CONCAT(NEW.usuario_id, ':', NEW.perfil_id), NULL,
    JSON_OBJECT('usuario_id', NEW.usuario_id, 'perfil_id', NEW.perfil_id));
END$$

CREATE TRIGGER trg_up_ad AFTER DELETE ON usuario_perfis FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'usuario.perfil_removido', 'usuario_perfis',
    CONCAT(OLD.usuario_id, ':', OLD.perfil_id),
    JSON_OBJECT('usuario_id', OLD.usuario_id, 'perfil_id', OLD.perfil_id), NULL);
END$$

CREATE TRIGGER trg_pp_ai AFTER INSERT ON perfil_permissoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NULL, 'perfil.permissao_concedida', 'perfil_permissoes',
    CONCAT(NEW.perfil_id, ':', NEW.permissao_codigo), NULL,
    JSON_OBJECT('perfil_id', NEW.perfil_id, 'permissao', NEW.permissao_codigo));
END$$

CREATE TRIGGER trg_pp_ad AFTER DELETE ON perfil_permissoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NULL, 'perfil.permissao_removida', 'perfil_permissoes',
    CONCAT(OLD.perfil_id, ':', OLD.permissao_codigo),
    JSON_OBJECT('perfil_id', OLD.perfil_id, 'permissao', OLD.permissao_codigo), NULL);
END$$

CREATE TRIGGER trg_config_ai AFTER INSERT ON configuracoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'config.criada', 'configuracoes', NEW.chave, NULL,
    JSON_OBJECT('valor', NEW.valor));
END$$

CREATE TRIGGER trg_config_au AFTER UPDATE ON configuracoes FOR EACH ROW
BEGIN
  IF NOT (OLD.valor <=> NEW.valor) THEN
    CALL sp_registrar_historico(NEW.site_id, 'config.alterada', 'configuracoes', NEW.chave,
      JSON_OBJECT('valor', OLD.valor), JSON_OBJECT('valor', NEW.valor));
  END IF;
END$$

DELIMITER ;
