-- =============================================================================
-- 004_seed.sql — catálogos obrigatórios (independentes de site)
-- Idempotente: pode ser executado novamente sem duplicar registros.
-- =============================================================================

SET NAMES utf8mb4;

-- Formas de pagamento da v1 --------------------------------------------------
INSERT INTO formas_pagamento (codigo, nome, permite_troco, exige_autorizacao, permite_parcelas, ordem) VALUES
  ('DINHEIRO', 'Dinheiro',          TRUE,  FALSE, FALSE, 1),
  ('PIX',      'Pix (presencial)',  FALSE, TRUE,  FALSE, 2),
  ('DEBITO',   'Cartão de débito',  FALSE, TRUE,  FALSE, 3),
  ('CREDITO',  'Cartão de crédito', FALSE, TRUE,  TRUE,  4)
AS novo
ON DUPLICATE KEY UPDATE nome = novo.nome;

-- Permissões ------------------------------------------------------------------
INSERT INTO permissoes (codigo, modulo, descricao) VALUES
  ('sessao.entrada',        'sessoes',    'Registrar entrada de veículo'),
  ('sessao.saida',          'sessoes',    'Registrar saída de veículo'),
  ('sessao.consultar',      'sessoes',    'Consultar sessões e tickets'),
  ('sessao.editar',         'sessoes',    'Corrigir placa, categoria ou vaga de sessão aberta'),
  ('sessao.ajustar_valor',  'sessoes',    'Conceder desconto ou acréscimo'),
  ('sessao.cancelar',       'sessoes',    'Cancelar sessão'),
  ('sessao.token_revogar',  'sessoes',    'Revogar e gerar novo QR/link do cliente'),
  ('pagamento.registrar',   'financeiro', 'Registrar pagamento'),
  ('pagamento.estornar',    'financeiro', 'Estornar pagamento'),
  ('caixa.operar',          'financeiro', 'Abrir e fechar o próprio caixa'),
  ('caixa.sangria',         'financeiro', 'Registrar sangria e suprimento'),
  ('caixa.supervisionar',   'financeiro', 'Ver e fechar caixas de outros operadores'),
  ('vaga.gerenciar',        'vagas',      'Cadastrar e editar vagas'),
  ('vaga.capacidade',       'vagas',      'Alterar a capacidade do estacionamento'),
  ('tarifa.ver',            'tarifas',    'Visualizar tabelas de tarifa'),
  ('tarifa.gerenciar',      'tarifas',    'Criar e editar rascunhos de tarifa'),
  ('tarifa.publicar',       'tarifas',    'Publicar e arquivar tabelas de tarifa'),
  ('cliente.gerenciar',     'cadastros',  'Cadastrar clientes'),
  ('veiculo.gerenciar',     'cadastros',  'Cadastrar e editar veículos'),
  ('funcionario.gerenciar', 'acesso',     'Cadastrar funcionários'),
  ('usuario.gerenciar',     'acesso',     'Criar usuários e atribuir perfis'),
  ('perfil.gerenciar',      'acesso',     'Editar perfis e permissões'),
  ('relatorio.operacional', 'relatorios', 'Relatórios de ocupação e movimento'),
  ('relatorio.financeiro',  'relatorios', 'Relatórios financeiros'),
  ('auditoria.ver',         'sistema',    'Consultar histórico de atividades'),
  ('sync.ver',              'sistema',    'Ver status da sincronização'),
  ('sync.gerenciar',        'sistema',    'Reenviar eventos e snapshot'),
  ('config.gerenciar',      'sistema',    'Alterar configurações do estacionamento')
AS novo
ON DUPLICATE KEY UPDATE modulo = novo.modulo, descricao = novo.descricao;

-- Perfis padrão (IDs fixos para referência em scripts) -------------------------
INSERT INTO perfis (id, codigo, nome, descricao, sistema) VALUES
  ('00000000000000000000000001', 'admin',      'Administrador', 'Acesso total',                              TRUE),
  ('00000000000000000000000002', 'operador',   'Operador',      'Entrada, saída, pagamento e caixa próprio', TRUE),
  ('00000000000000000000000003', 'financeiro', 'Financeiro',    'Relatórios e supervisão de caixa',          TRUE)
AS novo
ON DUPLICATE KEY UPDATE nome = novo.nome, descricao = novo.descricao;

-- admin: todas as permissões
INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo)
SELECT '00000000000000000000000001', codigo FROM permissoes;

-- operador
INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo) VALUES
  ('00000000000000000000000002', 'sessao.entrada'),
  ('00000000000000000000000002', 'sessao.saida'),
  ('00000000000000000000000002', 'sessao.consultar'),
  ('00000000000000000000000002', 'sessao.editar'),
  ('00000000000000000000000002', 'sessao.token_revogar'),
  ('00000000000000000000000002', 'pagamento.registrar'),
  ('00000000000000000000000002', 'caixa.operar'),
  ('00000000000000000000000002', 'tarifa.ver'),
  ('00000000000000000000000002', 'veiculo.gerenciar'),
  ('00000000000000000000000002', 'sync.ver');

-- financeiro
INSERT IGNORE INTO perfil_permissoes (perfil_id, permissao_codigo) VALUES
  ('00000000000000000000000003', 'sessao.consultar'),
  ('00000000000000000000000003', 'caixa.supervisionar'),
  ('00000000000000000000000003', 'caixa.sangria'),
  ('00000000000000000000000003', 'tarifa.ver'),
  ('00000000000000000000000003', 'relatorio.operacional'),
  ('00000000000000000000000003', 'relatorio.financeiro'),
  ('00000000000000000000000003', 'auditoria.ver'),
  ('00000000000000000000000003', 'sync.ver');
