-- =============================================================================
-- 016 — Níveis Administrador / Gerente / Operador, configurações por
-- categoria, correção de caixa fechado e incidentes de segurança (LGPD)
--
-- * Perfil de nível "gerente". O nível "funcionario" passa a se chamar
--   Operador (o código fica, para não mexer nos registros antigos).
-- * Funcionários que já tinham permissões de supervisão viram Gerente: ninguém
--   perde acesso com a atualização.
-- * Modelos "Padrão Gerente" e "Padrão Operador": as permissões que vêm
--   marcadas ao escolher o nível (o Administrador pode mudar).
-- * Caixa fechado aceita só AJUSTE (correção com motivo). Os valores do
--   fechamento nunca mudam: a correção fica registrada à parte.
-- * Logotipo: o histórico guarda o tamanho e o hash, não a imagem inteira.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Permissões novas
-- -----------------------------------------------------------------------------
INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('config.seguranca', 'sistema', 'Alterar regras de segurança, limites de ajuste e backup automático')
AS novo
ON DUPLICATE KEY UPDATE descricao = novo.descricao;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
VALUES ('00000000000000000000000001', 'config.seguranca');

-- -----------------------------------------------------------------------------
-- 2. Níveis
-- -----------------------------------------------------------------------------
INSERT INTO perfis (id, codigo, nome, descricao, uso, sistema) VALUES
  ('00000000000000000000000005', 'gerente', 'Gerente',
   'Supervisiona o dia a dia: caixas, relatórios e ajustes dentro do limite', 'NIVEL', TRUE)
AS novo
ON DUPLICATE KEY UPDATE nome = novo.nome, descricao = novo.descricao, uso = novo.uso;

UPDATE perfis SET nome = 'Operador',
       descricao = 'Atendimento: entradas, saídas, consulta de veículos e recebimento'
 WHERE codigo = 'funcionario';

-- Funcionários com permissões de supervisão passam a Gerente (mesmo acesso de antes)
UPDATE usuario_perfis up
   SET up.perfil_id = '00000000000000000000000005'
 WHERE up.perfil_id = '00000000000000000000000004'
   AND EXISTS (SELECT 1 FROM usuario_permissoes p
                WHERE p.usuario_id = up.usuario_id AND p.site_id = up.site_id
                  AND p.permissao_codigo IN ('tarifa.gerenciar', 'tarifa.publicar', 'relatorio.financeiro',
                      'funcionario.gerenciar', 'usuario.gerenciar', 'config.gerenciar', 'caixa.supervisionar',
                      'pagamento.estornar', 'sessao.cancelar', 'auditoria.ver', 'sync.gerenciar',
                      'lgpd.atender', 'sistema.monitorar'));

-- -----------------------------------------------------------------------------
-- 3. Permissões padrão de cada nível (modelos)
-- -----------------------------------------------------------------------------
INSERT INTO perfis (id, codigo, nome, descricao, uso, sistema) VALUES
  ('00000000000000000000000006', 'padrao_gerente',  'Padrão do Gerente',
   'Permissões marcadas ao cadastrar um Gerente', 'MODELO', TRUE),
  ('00000000000000000000000007', 'padrao_operador', 'Padrão do Operador',
   'Permissões marcadas ao cadastrar um Operador', 'MODELO', TRUE)
AS novo
ON DUPLICATE KEY UPDATE nome = novo.nome, descricao = novo.descricao, uso = novo.uso;

INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo) VALUES
  -- Gerente
  ('00000000000000000000000006', 'sessao.entrada'),
  ('00000000000000000000000006', 'sessao.saida'),
  ('00000000000000000000000006', 'sessao.consultar'),
  ('00000000000000000000000006', 'sessao.editar'),
  ('00000000000000000000000006', 'sessao.ajustar_valor'),
  ('00000000000000000000000006', 'sessao.cancelar'),
  ('00000000000000000000000006', 'sessao.token_revogar'),
  ('00000000000000000000000006', 'pagamento.registrar'),
  ('00000000000000000000000006', 'pagamento.estornar'),
  ('00000000000000000000000006', 'caixa.operar'),
  ('00000000000000000000000006', 'caixa.sangria'),
  ('00000000000000000000000006', 'caixa.supervisionar'),
  ('00000000000000000000000006', 'vaga.gerenciar'),
  ('00000000000000000000000006', 'tarifa.ver'),
  ('00000000000000000000000006', 'veiculo.gerenciar'),
  ('00000000000000000000000006', 'cliente.gerenciar'),
  ('00000000000000000000000006', 'relatorio.operacional'),
  ('00000000000000000000000006', 'relatorio.financeiro'),
  ('00000000000000000000000006', 'auditoria.ver'),
  ('00000000000000000000000006', 'sync.ver'),
  ('00000000000000000000000006', 'sistema.monitorar'),
  -- Operador
  ('00000000000000000000000007', 'sessao.entrada'),
  ('00000000000000000000000007', 'sessao.saida'),
  ('00000000000000000000000007', 'sessao.consultar'),
  ('00000000000000000000000007', 'pagamento.registrar'),
  ('00000000000000000000000007', 'caixa.operar'),
  ('00000000000000000000000007', 'tarifa.ver'),
  ('00000000000000000000000007', 'veiculo.gerenciar');

-- -----------------------------------------------------------------------------
-- 4. Caixa fechado: só aceita AJUSTE (correção registrada à parte)
-- -----------------------------------------------------------------------------
DROP TRIGGER trg_mov_bi_estorno;
DROP TRIGGER trg_mov_bi;

DELIMITER $$

CREATE TRIGGER trg_mov_bi BEFORE INSERT ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  IF NEW.caixa_sessao_id IS NOT NULL AND NEW.tipo <> 'AJUSTE'
     AND (SELECT status FROM caixa_sessoes WHERE id = NEW.caixa_sessao_id) <> 'ABERTO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Caixa fechado: não aceita movimentações';
  END IF;
  IF NEW.tipo = 'AJUSTE' THEN
    IF NEW.caixa_sessao_id IS NULL
       OR (SELECT status FROM caixa_sessoes WHERE id = NEW.caixa_sessao_id) <> 'FECHADO' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ajuste é a correção de um caixa já fechado';
    END IF;
    IF CHAR_LENGTH(TRIM(COALESCE(NEW.descricao, ''))) < 5 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ajuste exige o motivo da correção';
    END IF;
  END IF;
END$$

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

DROP TRIGGER trg_mov_ai$$
CREATE TRIGGER trg_mov_ai AFTER INSERT ON movimentacoes_financeiras FOR EACH ROW
BEGIN
  IF NEW.tipo IN ('SANGRIA', 'SUPRIMENTO', 'AJUSTE') THEN
    CALL sp_registrar_historico(NEW.site_id, CONCAT('caixa.', LOWER(NEW.tipo)), 'movimentacoes_financeiras', NEW.id, NULL,
      JSON_OBJECT('caixa_sessao_id', NEW.caixa_sessao_id, 'valor', NEW.valor_centavos, 'direcao', NEW.direcao,
                  'forma', NEW.forma_codigo, 'descricao', NEW.descricao));
  END IF;
END$$

-- -----------------------------------------------------------------------------
-- 5. Logotipo: o histórico guarda tamanho e hash, não a imagem
-- -----------------------------------------------------------------------------
DROP TRIGGER trg_config_ai$$
CREATE TRIGGER trg_config_ai AFTER INSERT ON configuracoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'config.criada', 'configuracoes', NEW.chave, NULL,
    IF(NEW.chave = 'logo',
       JSON_OBJECT('valor', JSON_OBJECT('bytes', CHAR_LENGTH(NEW.valor), 'sha256', SHA2(NEW.valor, 256))),
       JSON_OBJECT('valor', NEW.valor)));
END$$

DROP TRIGGER trg_config_au$$
CREATE TRIGGER trg_config_au AFTER UPDATE ON configuracoes FOR EACH ROW
BEGIN
  IF NOT (OLD.valor <=> NEW.valor) THEN
    IF NEW.chave = 'logo' THEN
      CALL sp_registrar_historico(NEW.site_id, 'config.alterada', 'configuracoes', NEW.chave,
        JSON_OBJECT('valor', JSON_OBJECT('bytes', CHAR_LENGTH(OLD.valor), 'sha256', SHA2(OLD.valor, 256))),
        JSON_OBJECT('valor', JSON_OBJECT('bytes', CHAR_LENGTH(NEW.valor), 'sha256', SHA2(NEW.valor, 256))));
    ELSE
      CALL sp_registrar_historico(NEW.site_id, 'config.alterada', 'configuracoes', NEW.chave,
        JSON_OBJECT('valor', OLD.valor), JSON_OBJECT('valor', NEW.valor));
    END IF;
  END IF;
END$$

DELIMITER ;

-- -----------------------------------------------------------------------------
-- 6. Incidentes de segurança com dados pessoais (LGPD art. 48)
-- -----------------------------------------------------------------------------
CREATE TABLE lgpd_incidentes (
  id                    CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id               CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  ocorrido_em           DATETIME(3)  NULL COMMENT 'Quando aconteceu (se conhecido)',
  detectado_em          DATETIME(3)  NOT NULL,
  descricao             VARCHAR(2000) NOT NULL,
  dados_afetados        VARCHAR(500) NOT NULL COMMENT 'Quais dados pessoais (ex.: placas, nomes, CPF)',
  titulares_afetados    INT UNSIGNED NULL COMMENT 'Quantidade estimada',
  gravidade             VARCHAR(5)   NOT NULL,
  medidas               VARCHAR(2000) NULL COMMENT 'O que foi feito para conter e evitar de novo',
  comunicado_anpd_em    DATETIME(3)  NULL,
  comunicado_titulares_em DATETIME(3) NULL,
  status                VARCHAR(10)  NOT NULL DEFAULT 'ABERTO',
  registrado_por        CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  registrado_em         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  encerrado_em          DATETIME(3)  NULL,
  atualizado_em         DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY ix_incidentes_site (site_id, detectado_em),
  CONSTRAINT fk_incidente_site    FOREIGN KEY (site_id)        REFERENCES sites (id),
  CONSTRAINT fk_incidente_usuario FOREIGN KEY (registrado_por) REFERENCES usuarios (id),
  CONSTRAINT ck_incidente_gravidade CHECK (gravidade IN ('BAIXA', 'MEDIA', 'ALTA')),
  CONSTRAINT ck_incidente_status    CHECK (status IN ('ABERTO', 'ENCERRADO')),
  CONSTRAINT ck_incidente_encerrado CHECK ((status = 'ENCERRADO') = (encerrado_em IS NOT NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Registro de incidentes de segurança (LGPD art. 48). Não pode ser apagado';

DELIMITER $$

CREATE TRIGGER trg_incidente_bd BEFORE DELETE ON lgpd_incidentes FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incidentes de segurança não podem ser apagados';
END$$

CREATE TRIGGER trg_incidente_bu BEFORE UPDATE ON lgpd_incidentes FOR EACH ROW
BEGIN
  IF OLD.status = 'ENCERRADO' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Incidente encerrado não pode ser alterado: registre um novo';
  END IF;
  IF NOT (OLD.descricao <=> NEW.descricao) OR NOT (OLD.detectado_em <=> NEW.detectado_em)
     OR NOT (OLD.registrado_por <=> NEW.registrado_por) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'A descrição original do incidente não pode ser alterada';
  END IF;
END$$

CREATE TRIGGER trg_incidente_ai AFTER INSERT ON lgpd_incidentes FOR EACH ROW
  CALL sp_registrar_historico(NEW.site_id, 'lgpd.incidente_registrado', 'lgpd_incidentes', NEW.id, NULL,
    JSON_OBJECT('gravidade', NEW.gravidade, 'dados_afetados', NEW.dados_afetados,
                'titulares_afetados', NEW.titulares_afetados))$$

CREATE TRIGGER trg_incidente_au AFTER UPDATE ON lgpd_incidentes FOR EACH ROW
  CALL sp_registrar_historico(NEW.site_id, 'lgpd.incidente_atualizado', 'lgpd_incidentes', NEW.id,
    JSON_OBJECT('status', OLD.status, 'gravidade', OLD.gravidade, 'medidas', OLD.medidas,
                'comunicado_anpd_em', OLD.comunicado_anpd_em, 'comunicado_titulares_em', OLD.comunicado_titulares_em),
    JSON_OBJECT('status', NEW.status, 'gravidade', NEW.gravidade, 'medidas', NEW.medidas,
                'comunicado_anpd_em', NEW.comunicado_anpd_em, 'comunicado_titulares_em', NEW.comunicado_titulares_em))$$

DELIMITER ;

-- -----------------------------------------------------------------------------
-- 7. Backup de segurança antes de uma restauração pelo painel
-- -----------------------------------------------------------------------------
ALTER TABLE backups DROP CHECK ck_backups_tipo;
ALTER TABLE backups MODIFY tipo VARCHAR(16) NOT NULL COMMENT 'AUTOMATICO | MANUAL | PRE_RESTAURACAO';
ALTER TABLE backups ADD CONSTRAINT ck_backups_tipo CHECK (tipo IN ('AUTOMATICO', 'MANUAL', 'PRE_RESTAURACAO'));

-- Restaurações feitas (pelo painel ou pelo Restaurar-Backup.cmd), para o painel
-- mostrar a última. Fica no banco restaurado, gravada depois da restauração.
CREATE TABLE backup_restauracoes (
  id              CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  arquivo         VARCHAR(120) NOT NULL,
  backup_seguranca VARCHAR(120) NULL COMMENT 'Backup feito logo antes, para desfazer',
  restaurado_por  CHAR(26)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  restaurado_em   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  tabelas         INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY ix_restauracoes_data (restaurado_em),
  CONSTRAINT fk_restauracao_usuario FOREIGN KEY (restaurado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- -----------------------------------------------------------------------------
-- 8. O resumo do caixa por forma não inclui as correções posteriores (AJUSTE):
--    o fechamento continua como foi feito; a correção aparece à parte.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW vw_caixa_resumo AS
SELECT
  m.caixa_sessao_id,
  m.forma_codigo,
  SUM(CASE WHEN m.direcao = 'ENTRADA' THEN m.valor_centavos ELSE 0 END) AS entradas_centavos,
  SUM(CASE WHEN m.direcao = 'SAIDA'   THEN m.valor_centavos ELSE 0 END) AS saidas_centavos,
  SUM(CASE WHEN m.direcao = 'ENTRADA' THEN m.valor_centavos ELSE -CAST(m.valor_centavos AS SIGNED) END) AS saldo_centavos,
  COUNT(*) AS movimentacoes
FROM movimentacoes_financeiras m
WHERE m.caixa_sessao_id IS NOT NULL AND m.tipo <> 'AJUSTE'
GROUP BY m.caixa_sessao_id, m.forma_codigo;
