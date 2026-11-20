-- =============================================================================
-- 002 — Consulta individual do ticket no app do cliente
--  * política de encerramento do link, definida no servidor local
--    (Configurações → Link do cliente) e mostrada ao cliente;
--  * nome da tarifa gravada no ticket (a tabela de preços do ticket é a
--    regra gravada na entrada, não a tabela em vigor hoje).
-- =============================================================================

ALTER TABLE sites_publicos
  ADD COLUMN horas_acesso_apos_saida SMALLINT UNSIGNED NOT NULL DEFAULT 24
    COMMENT 'Por quanto tempo o link funciona após a saída (0 = encerra na saída)' AFTER telefone;

ALTER TABLE tickets_publicos
  ADD COLUMN tarifa_nome VARCHAR(80) NULL COMMENT 'Padrão ou nome da tarifa especial' AFTER tarifa_descricao;

-- Limpeza periódica de acessos encerrados (a API apaga o que expirou)
CREATE INDEX ix_tickets_publicos_expira ON tickets_publicos (acesso_expira_em);
