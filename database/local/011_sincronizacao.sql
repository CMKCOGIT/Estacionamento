-- =============================================================================
-- 011 — Sincronização com a API externa (worker de envio)
--
-- Os eventos passam a carregar a PROJEÇÃO PÚBLICA do que mudou (versão 2 do
-- formato, docs/API-EXTERNA.md). Eventos antigos (versão 1) não são enviados:
-- a primeira conexão faz uma carga completa (snapshot), que já os cobre.
-- =============================================================================

ALTER TABLE sync_estado
  ADD COLUMN snapshot_pendente  BOOLEAN NOT NULL DEFAULT TRUE COMMENT 'Enviar a carga completa antes dos eventos' AFTER ultimo_snapshot_em,
  ADD COLUMN falhas_seguidas    INT UNSIGNED NOT NULL DEFAULT 0 AFTER snapshot_pendente,
  ADD COLUMN ultimo_contato_em  DATETIME(3) NULL COMMENT 'Última resposta da nuvem (inclui sinal de vida)' AFTER ultimo_sucesso_em;

INSERT IGNORE INTO sync_estado (site_id) SELECT id FROM sites;

UPDATE sync_outbox
   SET status = 'ENVIADO', enviado_em = NOW(3), ultimo_erro = 'Formato antigo: coberto pela carga completa'
 WHERE status = 'PENDENTE' AND versao < 2;

-- Fila de envio: pendentes em ordem, prontos para nova tentativa
CREATE INDEX ix_outbox_envio ON sync_outbox (status, proxima_tentativa_em, seq);
