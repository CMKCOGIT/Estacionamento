-- =============================================================================
-- 003_views.sql — consultas prontas usadas pelo painel e pela sincronização
-- =============================================================================

-- Capacidade e ocupação por categoria (fonte do evento vagas.disponibilidade).
CREATE OR REPLACE VIEW vw_ocupacao_categoria AS
SELECT
  c.site_id,
  c.id                                                          AS categoria_id,
  c.codigo                                                      AS categoria_codigo,
  c.nome                                                        AS categoria_nome,
  COUNT(CASE WHEN v.situacao IN ('ATIVA','MANUTENCAO') THEN 1 END) AS capacidade_total,
  COUNT(CASE WHEN v.situacao = 'MANUTENCAO' THEN 1 END)            AS em_manutencao,
  COUNT(s.vaga_ocupada_id)                                         AS ocupadas,
  COUNT(CASE WHEN v.situacao = 'ATIVA' THEN 1 END)
    - COUNT(s.vaga_ocupada_id)                                     AS livres
FROM categorias_veiculo c
LEFT JOIN vagas v
       ON v.categoria_id = c.id
LEFT JOIN sessoes_estacionamento s
       ON s.vaga_ocupada_id = v.id
WHERE c.ativo = TRUE
GROUP BY c.site_id, c.id, c.codigo, c.nome;

-- Situação de cada vaga (mapa de vagas no painel).
CREATE OR REPLACE VIEW vw_vagas_situacao AS
SELECT
  v.site_id, v.id AS vaga_id, v.codigo, v.setor, v.categoria_id, v.situacao,
  s.id AS sessao_id, s.numero AS sessao_numero, s.placa, s.entrada_em,
  CASE
    WHEN v.situacao <> 'ATIVA' THEN v.situacao
    WHEN s.id IS NOT NULL      THEN 'OCUPADA'
    ELSE 'LIVRE'
  END AS estado
FROM vagas v
LEFT JOIN sessoes_estacionamento s ON s.vaga_ocupada_id = v.id
WHERE v.situacao <> 'INATIVA';

-- Sessões em andamento com total já pago.
CREATE OR REPLACE VIEW vw_sessoes_abertas AS
SELECT
  s.site_id, s.id AS sessao_id, s.numero, s.placa, s.categoria_id, s.vaga_id,
  v.codigo AS vaga_codigo, s.modalidade, s.entrada_em, s.tarifa_regra_id,
  COALESCE((SELECT SUM(p.valor_centavos) FROM pagamentos p
            WHERE p.sessao_id = s.id AND p.status = 'CONFIRMADO'), 0) AS pago_centavos
FROM sessoes_estacionamento s
LEFT JOIN vagas v ON v.id = s.vaga_id
WHERE s.status = 'ABERTA';

-- Resumo do caixa por forma de pagamento (conferência/fechamento).
CREATE OR REPLACE VIEW vw_caixa_resumo AS
SELECT
  m.caixa_sessao_id,
  m.forma_codigo,
  SUM(CASE WHEN m.direcao = 'ENTRADA' THEN m.valor_centavos ELSE 0 END) AS entradas_centavos,
  SUM(CASE WHEN m.direcao = 'SAIDA'   THEN m.valor_centavos ELSE 0 END) AS saidas_centavos,
  SUM(CASE WHEN m.direcao = 'ENTRADA' THEN m.valor_centavos ELSE -CAST(m.valor_centavos AS SIGNED) END) AS saldo_centavos,
  COUNT(*) AS movimentacoes
FROM movimentacoes_financeiras m
WHERE m.caixa_sessao_id IS NOT NULL
GROUP BY m.caixa_sessao_id, m.forma_codigo;

-- Tabela de tarifa vigente agora (por site).
CREATE OR REPLACE VIEW vw_tarifa_vigente AS
SELECT t.*
FROM tabelas_tarifa t
WHERE t.status = 'PUBLICADA'
  AND t.vigente_desde <= UTC_TIMESTAMP(3)
  AND NOT EXISTS (
    SELECT 1 FROM tabelas_tarifa t2
    WHERE t2.site_id = t.site_id AND t2.status = 'PUBLICADA'
      AND t2.vigente_desde <= UTC_TIMESTAMP(3)
      AND (t2.vigente_desde > t.vigente_desde
           OR (t2.vigente_desde = t.vigente_desde AND t2.versao > t.versao)));

-- Painel de sincronização.
CREATE OR REPLACE VIEW vw_sync_status AS
SELECT
  e.site_id,
  e.ultimo_seq_confirmado,
  e.ultimo_sucesso_em,
  e.ultimo_erro_em,
  e.ultimo_erro,
  (SELECT COUNT(*) FROM sync_outbox o WHERE o.site_id = e.site_id AND o.status = 'PENDENTE')  AS pendentes,
  (SELECT COUNT(*) FROM sync_outbox o WHERE o.site_id = e.site_id AND o.status = 'REJEITADO') AS rejeitados,
  (SELECT MIN(o.ocorrido_em) FROM sync_outbox o WHERE o.site_id = e.site_id AND o.status = 'PENDENTE') AS pendente_mais_antigo
FROM sync_estado e;
