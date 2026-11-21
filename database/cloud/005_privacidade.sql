-- =============================================================================
-- 005 — Contato do encarregado de dados (LGPD art. 41), mostrado no app do cliente
-- =============================================================================

ALTER TABLE sites_publicos ADD COLUMN contato_privacidade VARCHAR(200) NULL AFTER telefone;
