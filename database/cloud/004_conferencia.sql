-- =============================================================================
-- 004 — Conferência entre os bancos (servidor local × nuvem)
--
-- O servidor local manda a "impressão digital" (SHA-256 da forma canônica)
-- do estado atual de cada item visível; a nuvem remonta cada item a partir
-- do que tem gravado AGORA, calcula a mesma impressão e aponta o que está
-- diferente, faltando ou sobrando (/sync/v1/conferir). Assim a conferência
-- pega também dados alterados ou corrompidos direto no banco da nuvem.
-- =============================================================================

ALTER TABLE sync_estado ADD COLUMN ultima_conferencia_em DATETIME(3) NULL;
