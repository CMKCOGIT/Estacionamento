-- =============================================================================
-- 006_usuarios_permissoes.sql — níveis de acesso e permissões por funcionário
--
-- Dois níveis (perfis com uso = 'NIVEL'):
--   * admin       → acesso completo (todas as permissões, inclusive futuras)
--   * funcionario → somente as permissões marcadas pelo administrador
--                   (tabela usuario_permissoes)
-- Os perfis 'operador' e 'financeiro' passam a ser MODELOS: conjuntos prontos
-- de permissões que o administrador aplica com um clique.
-- =============================================================================

SET NAMES utf8mb4;

-- -----------------------------------------------------------------------------
-- 1. Perfis: nível de acesso x modelo
-- -----------------------------------------------------------------------------
ALTER TABLE perfis
  ADD COLUMN uso VARCHAR(10) NOT NULL DEFAULT 'NIVEL' AFTER descricao,
  ADD CONSTRAINT ck_perfis_uso CHECK (uso IN ('NIVEL', 'MODELO'));

INSERT INTO perfis (id, codigo, nome, descricao, uso, sistema) VALUES
  ('00000000000000000000000004', 'funcionario', 'Funcionário',
   'Acesso somente às funcionalidades autorizadas pelo administrador', 'NIVEL', TRUE)
AS novo
ON DUPLICATE KEY UPDATE nome = novo.nome, descricao = novo.descricao, uso = novo.uso;

UPDATE perfis SET uso = 'MODELO', nome = 'Operador de caixa',
       descricao = 'Modelo: entrada, saída, pagamento e caixa próprio'
 WHERE codigo = 'operador';
UPDATE perfis SET uso = 'MODELO', nome = 'Financeiro',
       descricao = 'Modelo: relatórios, supervisão de caixa e histórico'
 WHERE codigo = 'financeiro';
UPDATE perfis SET descricao = 'Acesso completo ao sistema' WHERE codigo = 'admin';

-- -----------------------------------------------------------------------------
-- 2. Permissões individuais do funcionário
-- -----------------------------------------------------------------------------
CREATE TABLE usuario_permissoes (
  usuario_id        CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  site_id           CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  permissao_codigo  VARCHAR(60) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  concedido_por     CHAR(26)    CHARACTER SET ascii COLLATE ascii_bin NULL,
  concedido_em      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (usuario_id, site_id, permissao_codigo),
  KEY ix_usuario_permissoes_permissao (permissao_codigo),
  KEY ix_usuario_permissoes_site (site_id),
  CONSTRAINT fk_uperm_usuario   FOREIGN KEY (usuario_id)       REFERENCES usuarios (id),
  CONSTRAINT fk_uperm_site      FOREIGN KEY (site_id)          REFERENCES sites (id),
  CONSTRAINT fk_uperm_permissao FOREIGN KEY (permissao_codigo) REFERENCES permissoes (codigo),
  CONSTRAINT fk_uperm_concedido FOREIGN KEY (concedido_por)    REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  COMMENT='Permissões concedidas individualmente (nível Funcionário)';

-- -----------------------------------------------------------------------------
-- 3. Converte usuários que tinham perfil operador/financeiro em Funcionário
--    com as mesmas permissões (nada muda para eles na prática).
-- -----------------------------------------------------------------------------
INSERT IGNORE INTO usuario_permissoes (usuario_id, site_id, permissao_codigo)
SELECT up.usuario_id, up.site_id, pp.permissao_codigo
  FROM usuario_perfis up
  JOIN perfis p             ON p.id = up.perfil_id AND p.uso = 'MODELO'
  JOIN perfil_permissoes pp ON pp.perfil_id = p.id;

INSERT IGNORE INTO usuario_perfis (usuario_id, site_id, perfil_id)
SELECT DISTINCT up.usuario_id, up.site_id, '00000000000000000000000004'
  FROM usuario_perfis up
  JOIN perfis p ON p.id = up.perfil_id AND p.uso = 'MODELO'
 WHERE NOT EXISTS (SELECT 1 FROM usuario_perfis a JOIN perfis pa ON pa.id = a.perfil_id
                    WHERE a.usuario_id = up.usuario_id AND a.site_id = up.site_id AND pa.codigo = 'admin');

DELETE up FROM usuario_perfis up JOIN perfis p ON p.id = up.perfil_id WHERE p.uso = 'MODELO';

-- -----------------------------------------------------------------------------
-- 4. Triggers: integridade e histórico de atividades
-- -----------------------------------------------------------------------------
DELIMITER $$

-- Usuário só recebe perfis do tipo NIVEL (admin ou funcionario).
CREATE TRIGGER trg_up_bi BEFORE INSERT ON usuario_perfis FOR EACH ROW
BEGIN
  IF (SELECT uso FROM perfis WHERE id = NEW.perfil_id) <> 'NIVEL' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Perfil do tipo modelo não pode ser atribuído a um usuário';
  END IF;
END$$

CREATE TRIGGER trg_uperm_ai AFTER INSERT ON usuario_permissoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'usuario.permissao_concedida', 'usuario_permissoes',
    CONCAT(NEW.usuario_id, ':', NEW.permissao_codigo), NULL,
    JSON_OBJECT('usuario_id', NEW.usuario_id, 'permissao', NEW.permissao_codigo));
END$$

CREATE TRIGGER trg_uperm_ad AFTER DELETE ON usuario_permissoes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'usuario.permissao_removida', 'usuario_permissoes',
    CONCAT(OLD.usuario_id, ':', OLD.permissao_codigo),
    JSON_OBJECT('usuario_id', OLD.usuario_id, 'permissao', OLD.permissao_codigo), NULL);
END$$

CREATE TRIGGER trg_usuarios_ai AFTER INSERT ON usuarios FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NULL, 'usuario.criado', 'usuarios', NEW.id, NULL,
    JSON_OBJECT('login', NEW.login, 'email', NEW.email, 'ativo', NEW.ativo));
END$$

CREATE TRIGGER trg_funcionarios_ai AFTER INSERT ON funcionarios FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'funcionario.cadastrado', 'funcionarios', NEW.id, NULL,
    JSON_OBJECT('nome', NEW.nome, 'cargo', NEW.cargo, 'usuario_id', NEW.usuario_id));
END$$

CREATE TRIGGER trg_funcionarios_au AFTER UPDATE ON funcionarios FOR EACH ROW
BEGIN
  IF NOT (OLD.nome <=> NEW.nome) OR NOT (OLD.cpf <=> NEW.cpf) OR NOT (OLD.telefone <=> NEW.telefone)
     OR NOT (OLD.email <=> NEW.email) OR NOT (OLD.cargo <=> NEW.cargo)
     OR NOT (OLD.data_admissao <=> NEW.data_admissao) OR NOT (OLD.data_desligamento <=> NEW.data_desligamento)
     OR NOT (OLD.ativo <=> NEW.ativo) OR NOT (OLD.usuario_id <=> NEW.usuario_id) THEN
    CALL sp_registrar_historico(NEW.site_id,
      CASE WHEN OLD.ativo = TRUE AND NEW.ativo = FALSE THEN 'funcionario.desligado'
           WHEN OLD.ativo = FALSE AND NEW.ativo = TRUE THEN 'funcionario.readmitido'
           ELSE 'funcionario.alterado' END,
      'funcionarios', NEW.id,
      JSON_OBJECT('nome', OLD.nome, 'cpf', OLD.cpf, 'telefone', OLD.telefone, 'email', OLD.email,
                  'cargo', OLD.cargo, 'data_admissao', OLD.data_admissao,
                  'data_desligamento', OLD.data_desligamento, 'ativo', OLD.ativo, 'usuario_id', OLD.usuario_id),
      JSON_OBJECT('nome', NEW.nome, 'cpf', NEW.cpf, 'telefone', NEW.telefone, 'email', NEW.email,
                  'cargo', NEW.cargo, 'data_admissao', NEW.data_admissao,
                  'data_desligamento', NEW.data_desligamento, 'ativo', NEW.ativo, 'usuario_id', NEW.usuario_id));
  END IF;
END$$

-- Registro de ENTRADA de veículo (a saída já era registrada em trg_sessoes_au).
CREATE TRIGGER trg_sessoes_ai AFTER INSERT ON sessoes_estacionamento FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(NEW.site_id, 'sessao.entrada', 'sessoes_estacionamento', NEW.id, NULL,
    JSON_OBJECT('numero', NEW.numero, 'placa', NEW.placa, 'vaga_id', NEW.vaga_id,
                'categoria_id', NEW.categoria_id, 'modalidade', NEW.modalidade, 'entrada_em', NEW.entrada_em));
END$$

-- Exclusões em cadastros (o que não pode ser excluído já é bloqueado em 002).
CREATE TRIGGER trg_vagas_ad AFTER DELETE ON vagas FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'vaga.excluida', 'vagas', OLD.id,
    JSON_OBJECT('codigo', OLD.codigo, 'setor', OLD.setor, 'categoria_id', OLD.categoria_id, 'situacao', OLD.situacao), NULL);
END$$

CREATE TRIGGER trg_tabelas_ad AFTER DELETE ON tabelas_tarifa FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'tarifa.rascunho_excluido', 'tabelas_tarifa', OLD.id,
    JSON_OBJECT('versao', OLD.versao, 'nome', OLD.nome), NULL);
END$$

CREATE TRIGGER trg_categorias_ad AFTER DELETE ON categorias_veiculo FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'categoria.excluida', 'categorias_veiculo', OLD.id,
    JSON_OBJECT('codigo', OLD.codigo, 'nome', OLD.nome), NULL);
END$$

CREATE TRIGGER trg_clientes_ad AFTER DELETE ON clientes FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'cliente.excluido', 'clientes', OLD.id,
    JSON_OBJECT('nome', OLD.nome), NULL);
END$$

CREATE TRIGGER trg_veiculos_ad AFTER DELETE ON veiculos FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'veiculo.excluido', 'veiculos', OLD.id,
    JSON_OBJECT('placa', OLD.placa), NULL);
END$$

CREATE TRIGGER trg_postos_ad AFTER DELETE ON postos FOR EACH ROW
BEGIN
  CALL sp_registrar_historico(OLD.site_id, 'posto.excluido', 'postos', OLD.id,
    JSON_OBJECT('nome', OLD.nome), NULL);
END$$

-- Funcionário nunca é excluído: ele aparece no histórico. Use desligamento.
CREATE TRIGGER trg_funcionarios_bd BEFORE DELETE ON funcionarios FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Funcionário não pode ser excluído; registre o desligamento';
END$$

CREATE TRIGGER trg_usuarios_bd BEFORE DELETE ON usuarios FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Usuário não pode ser excluído; desative o acesso';
END$$

DELIMITER ;
