#!/usr/bin/env bash
# Testes de integridade do banco local.
# Uso:  MYSQL="mysql -h127.0.0.1 -uroot -proot" ./run_tests.sh
#   ou: MYSQL="docker exec -i mysqltest mysql -uroot -proot" ./run_tests.sh
# Cria o banco est_test do zero, aplica os scripts e executa os cenários.
set -uo pipefail
cd "$(dirname "$0")/.."

MYSQL=${MYSQL:-"mysql -uroot"}
DB=est_test
PASS=0; FAIL=0

run()  { $MYSQL "$DB" 2>&1 | grep -v "Using a password"; }

$MYSQL -e "DROP DATABASE IF EXISTS $DB; CREATE DATABASE $DB CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;" 2>&1 | grep -v "Using a password"
for f in 001_schema.sql 002_triggers.sql 003_views.sql 004_seed.sql; do
  out=$(run < "$f"); [ -n "$out" ] && { echo "ERRO aplicando $f:"; echo "$out"; exit 1; }
done

# Contexto comum (IDs curtos para legibilidade; a aplicação usa ULIDs reais)
SETUP="SET time_zone='+00:00'; SET @app_usuario_id='U1';"

ok() {   # ok "descrição" "sql"
  local out; out=$(echo "$SETUP $2" | run)
  if [ -z "$out" ] || ! grep -q "ERROR" <<<"$out"; then PASS=$((PASS+1)); echo "  ✔ $1"
  else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      $out"; fi
}
fail() { # fail "descrição" "sql" "trecho esperado da mensagem"
  local out; out=$(echo "$SETUP $2" | run)
  if grep -q "ERROR" <<<"$out" && grep -qi -- "$3" <<<"$out"; then PASS=$((PASS+1)); echo "  ✔ $1"
  else FAIL=$((FAIL+1)); echo "  ✘ $1 (esperado: $3)"; echo "      ${out:-<sem erro>}"; fi
}
expect() { # expect "descrição" "sql que retorna 1 valor" "valor esperado"
  local out; out=$(echo "$SETUP $2" | $MYSQL -N "$DB" 2>&1 | grep -v "Using a password")
  if [ "$out" = "$3" ]; then PASS=$((PASS+1)); echo "  ✔ $1"
  else FAIL=$((FAIL+1)); echo "  ✘ $1 (esperado '$3', obtido '$out')"; fi
}

echo "== Cadastro base"
ok "site, usuário, perfil" "
INSERT INTO sites (id, slug, nome) VALUES ('S1','centro','Estacionamento Centro');
INSERT INTO usuarios (id, login, senha_hash) VALUES ('U1','admin','\$argon2id\$x'),('U2','joao','\$argon2id\$y');
INSERT INTO usuario_perfis (usuario_id, site_id, perfil_id) VALUES ('U1','S1','00000000000000000000000001');
INSERT INTO postos (id, site_id, nome) VALUES ('P1','S1','Guichê 1'),('P2','S1','Guichê 2');
INSERT INTO categorias_veiculo (id, site_id, codigo, nome) VALUES ('CAR','S1','CARRO','Carro'),('MOT','S1','MOTO','Moto');
INSERT INTO vagas (id, site_id, codigo, categoria_id) VALUES
  ('V1','S1','A-01','CAR'),('V2','S1','A-02','CAR'),('V3','S1','M-01','MOT');"
fail "login duplicado"        "INSERT INTO usuarios (id, login, senha_hash) VALUES ('U9','admin','h');" "Duplicate"
fail "login inválido"         "INSERT INTO usuarios (id, login, senha_hash) VALUES ('U9','Admin Silva','h');" "ck_usuarios_login"
fail "código de vaga repetido" "INSERT INTO vagas (id, site_id, codigo, categoria_id) VALUES ('V9','S1','A-01','CAR');" "Duplicate"
fail "vaga inativa sem data"  "INSERT INTO vagas (id, site_id, codigo, categoria_id, situacao) VALUES ('V9','S1','A-09','CAR','INATIVA');" "ck_vagas_inativa"

echo "== Veículos"
ok   "placa antiga e Mercosul" "INSERT INTO veiculos (id, site_id, placa, categoria_id) VALUES ('VE1','S1','ABC1234','CAR'),('VE2','S1','ABC1D23','CAR'),('VE3','S1','MOT1A11','MOT');"
fail "placa duplicada"        "INSERT INTO veiculos (id, site_id, placa, categoria_id) VALUES ('VE9','S1','ABC1234','CAR');" "Duplicate"
fail "placa fora do padrão"   "INSERT INTO veiculos (id, site_id, placa, categoria_id) VALUES ('VE9','S1','ABC-1234','CAR');" "ck_veiculos_placa"
ok   "placa estrangeira"      "INSERT INTO veiculos (id, site_id, placa, placa_estrangeira, categoria_id) VALUES ('VE4','S1','AB123CD',TRUE,'CAR');"

echo "== Tarifas"
ok   "rascunho com regras"    "
INSERT INTO tabelas_tarifa (id, site_id, versao, nome, criado_por) VALUES ('T1','S1',1,'Tabela 2026','U1');
INSERT INTO tarifa_regras (id, tabela_id, categoria_id, tolerancia_min, primeira_hora_centavos, hora_adicional_centavos, fracao_min, fracao_centavos, diaria_maxima_centavos)
VALUES ('R1','T1','CAR',10,1000,600,15,200,4000),('R2','T1','MOT',10,500,300,NULL,NULL,2000);"
fail "fração incompleta"      "INSERT INTO tabelas_tarifa (id, site_id, versao, nome, criado_por) VALUES ('T8','S1',8,'x','U1');
INSERT INTO tarifa_regras (id, tabela_id, categoria_id, primeira_hora_centavos, hora_adicional_centavos, fracao_min) VALUES ('R8','T8','CAR',1,1,15);" "ck_regras_fracao"
fail "publicar sem regras"    "UPDATE tabelas_tarifa SET status='PUBLICADA', vigente_desde=NOW(3), publicado_em=NOW(3), publicado_por='U1' WHERE id='T8';" "sem regras"
fail "sessão com tarifa rascunho" "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('X0','S1',99,'VE1','ABC1234','CAR','V1','R1',NOW(3),'U1');" "PUBLICADA"
ok   "publicar T1"            "UPDATE tabelas_tarifa SET status='PUBLICADA', vigente_desde='2026-01-01', publicado_em=NOW(3), publicado_por='U1' WHERE id='T1';"
fail "editar regra publicada" "UPDATE tarifa_regras SET primeira_hora_centavos=1 WHERE id='R1';" "imutáveis"
fail "editar tabela publicada" "UPDATE tabelas_tarifa SET nome='outra' WHERE id='T1';" "imutável"
fail "excluir tabela publicada" "DELETE FROM tabelas_tarifa WHERE id='T1';" "rascunhos"
fail "versão repetida"        "INSERT INTO tabelas_tarifa (id, site_id, versao, nome, criado_por) VALUES ('T9','S1',1,'dup','U1');" "Duplicate"
expect "tarifa vigente"       "SELECT id FROM vw_tarifa_vigente WHERE site_id='S1';" "T1"
expect "histórico da publicação" "SELECT JSON_LENGTH(dados_novos->'\$.regras') FROM historico_atividades WHERE acao='tarifa.publicada';" "2"

echo "== Sessões (entrada)"
ok   "entrada ABC1234 na A-01" "
INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id, posto_entrada_id)
VALUES ('S01','S1',1,'VE1','ABC1234','CAR','V1','R1','2026-11-18 12:00:00','U1','P1');
INSERT INTO sessao_tokens (id, sessao_id, token_hash, criado_por) VALUES ('K1','S01',UNHEX(SHA2('tok1',256)),'U1');"
fail "mesma vaga ocupada"     "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S02','S1',2,'VE2','ABC1D23','CAR','V1','R1',NOW(3),'U1');" "uq_sessoes_vaga_aberta"
fail "mesmo veículo 2x aberto" "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S02','S1',2,'VE1','ABC1234','CAR','V2','R1',NOW(3),'U1');" "uq_sessoes_veiculo_aberto"
fail "número de ticket repetido" "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S02','S1',1,'VE2','ABC1D23','CAR','V2','R1',NOW(3),'U1');" "uq_sessoes_numero"
fail "segundo token ativo"    "INSERT INTO sessao_tokens (id, sessao_id, token_hash, criado_por) VALUES ('K2','S01',UNHEX(SHA2('tok2',256)),'U1');" "uq_tokens_ativo_sessao"
ok   "revogar e gerar novo token" "
UPDATE sessao_tokens SET revogado_em=NOW(3), revogado_por='U1', motivo_revogacao='cliente perdeu' WHERE id='K1';
INSERT INTO sessao_tokens (id, sessao_id, token_hash, criado_por) VALUES ('K2','S01',UNHEX(SHA2('tok2',256)),'U1');"
fail "reativar token revogado" "UPDATE sessao_tokens SET revogado_em=NULL, revogado_por=NULL WHERE id='K1';" "reativado"
fail "inativar vaga ocupada"  "UPDATE vagas SET situacao='INATIVA', desativada_em=NOW(3) WHERE id='V1';" "Vaga ocupada"
ok   "vaga V2 em manutenção"  "UPDATE vagas SET situacao='MANUTENCAO' WHERE id='V2';"
fail "entrar em vaga em manutenção" "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S02','S1',2,'VE2','ABC1D23','CAR','V2','R1',NOW(3),'U1');" "indisponível"
expect "ocupação carro (total/manut/ocup/livres)" "SELECT CONCAT_WS('/',capacidade_total,em_manutencao,ocupadas,livres) FROM vw_ocupacao_categoria WHERE categoria_codigo='CARRO';" "2/1/1/0"
ok   "trocar placa (auditado)" "SET @app_motivo='digitação'; UPDATE sessoes_estacionamento SET placa='ABC1234' , observacoes='ok' WHERE id='S01';"
expect "versão otimista incrementa" "SELECT versao FROM sessoes_estacionamento WHERE id='S01';" "2"

echo "== Caixa e pagamento"
ok   "abrir caixa"            "INSERT INTO caixa_sessoes (id, site_id, posto_id, operador_id, aberto_em, saldo_inicial_centavos) VALUES ('C1','S1','P1','U1',NOW(3),5000);
INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, registrado_por, registrado_em)
VALUES ('M0','S1','C1','ABERTURA','ENTRADA',5000,'DINHEIRO','U1',NOW(3));"
fail "2º caixa no mesmo posto" "INSERT INTO caixa_sessoes (id, site_id, posto_id, operador_id, aberto_em) VALUES ('C2','S1','P1','U2',NOW(3));" "uq_caixa_posto_aberto"
fail "2º caixa do mesmo operador" "INSERT INTO caixa_sessoes (id, site_id, posto_id, operador_id, aberto_em) VALUES ('C2','S1','P2','U1',NOW(3));" "uq_caixa_operador_aberto"
ok   "pagamento dividido: 10,00 dinheiro (recebe 20,00) + 10,00 Pix" "
INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos, troco_centavos, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG1','S1','S01','C1','DINHEIRO',1000,2000,1000,'11111111-1111-1111-1111-111111111111','U1',NOW(3));
INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em)
VALUES ('M1','S1','C1','RECEBIMENTO','ENTRADA',1000,'DINHEIRO','PG1','S01','U1',NOW(3));
INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, autorizacao, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG2','S1','S01','C1','PIX',1000,'E123','22222222-2222-2222-2222-222222222222','U1',NOW(3));
INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em)
VALUES ('M2','S1','C1','RECEBIMENTO','ENTRADA',1000,'PIX','PG2','S01','U1',NOW(3));"
fail "pagamento duplicado (mesma chave)" "INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG9','S1','S01','C1','PIX',1000,'22222222-2222-2222-2222-222222222222','U1',NOW(3));" "uq_pagamentos_idempotencia"
fail "troco calculado errado" "INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos, troco_centavos, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG9','S1','S01','C1','DINHEIRO',1000,2000,500,'99999999-9999-9999-9999-999999999999','U1',NOW(3));" "ck_pag_troco"
fail "recebido menor que valor" "INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos, troco_centavos, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG9','S1','S01','C1','DINHEIRO',1000,500,0,'99999999-9999-9999-9999-999999999999','U1',NOW(3));" "ck_pag_troco"
fail "troco em cartão"        "INSERT INTO pagamentos (id, site_id, sessao_id, caixa_sessao_id, forma_codigo, valor_centavos, valor_recebido_centavos, troco_centavos, chave_idempotencia, registrado_por, registrado_em)
VALUES ('PG9','S1','S01','C1','DEBITO',1000,2000,1000,'99999999-9999-9999-9999-999999999999','U1',NOW(3));" "não aceita troco"
fail "recebimento duplicado do mesmo pagamento" "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, registrado_por, registrado_em)
VALUES ('M9','S1','C1','RECEBIMENTO','ENTRADA',1000,'PIX','PG2','U1',NOW(3));" "uq_mov_pagamento_tipo"
fail "sangria como entrada"   "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, registrado_por, registrado_em)
VALUES ('M9','S1','C1','SANGRIA','ENTRADA',100,'DINHEIRO','U1',NOW(3));" "ck_mov_tipo"
fail "alterar valor do pagamento" "UPDATE pagamentos SET valor_centavos=1 WHERE id='PG1';" "Somente\|só admite"
fail "excluir pagamento"      "DELETE FROM pagamentos WHERE id='PG1';" "estorno"
fail "alterar movimentação"   "UPDATE movimentacoes_financeiras SET valor_centavos=1 WHERE id='M1';" "não pode ser alterada"
fail "encerrar com valor diferente do pago" "UPDATE sessoes_estacionamento SET status='ENCERRADA', saida_em='2026-11-18 14:20:00', operador_saida_id='U1',
  valor_calculado_centavos=2500, valor_final_centavos=2500 WHERE id='S01';" "Soma dos pagamentos"
fail "valor final inconsistente" "UPDATE sessoes_estacionamento SET status='ENCERRADA', saida_em='2026-11-18 14:20:00', operador_saida_id='U1',
  valor_calculado_centavos=2000, desconto_centavos=500, motivo_ajuste='x', valor_final_centavos=2000 WHERE id='S01';" "ck_sessoes_valor_final"
fail "saída antes da entrada" "UPDATE sessoes_estacionamento SET status='ENCERRADA', saida_em='2026-11-18 11:00:00', operador_saida_id='U1',
  valor_calculado_centavos=2000, valor_final_centavos=2000 WHERE id='S01';" "ck_sessoes_datas"
ok   "encerrar 2h20 = R\$ 20,00" "UPDATE sessoes_estacionamento SET status='ENCERRADA', saida_em='2026-11-18 14:20:00', operador_saida_id='U1', posto_saida_id='P1',
  valor_calculado_centavos=2000, valor_final_centavos=2000 WHERE id='S01';
UPDATE sessao_tokens SET expira_em='2026-11-19 14:20:00' WHERE id='K2';"
fail "alterar sessão encerrada" "UPDATE sessoes_estacionamento SET placa='ZZZ9Z99' WHERE id='S01';" "não pode ser alterada"
fail "excluir sessão"         "DELETE FROM sessoes_estacionamento WHERE id='S01';" "cancelamento"
expect "vaga A-01 liberada"   "SELECT estado FROM vw_vagas_situacao WHERE codigo='A-01';" "LIVRE"
ok   "estorno do Pix"         "SET @app_motivo='cliente pagou em dobro';
UPDATE pagamentos SET status='ESTORNADO', estornado_em=NOW(3), estornado_por='U1', motivo_estorno='cliente pagou em dobro' WHERE id='PG2';
INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, pagamento_id, sessao_id, registrado_por, registrado_em)
VALUES ('M3','S1','C1','ESTORNO','SAIDA',1000,'PIX','PG2','S01','U1',NOW(3));"
fail "estornar duas vezes"    "UPDATE pagamentos SET motivo_estorno='de novo' WHERE id='PG2';" "só admite"
expect "saldo do caixa em dinheiro" "SELECT saldo_centavos FROM vw_caixa_resumo WHERE caixa_sessao_id='C1' AND forma_codigo='DINHEIRO';" "6000"
fail "fechar caixa com diferença errada" "UPDATE caixa_sessoes SET status='FECHADO', fechado_em=NOW(3), fechado_por='U1', saldo_esperado_centavos=6000, saldo_contado_centavos=5900, diferenca_centavos=0 WHERE id='C1';" "ck_caixa_diferenca"
ok   "fechar caixa (falta 1,00)" "UPDATE caixa_sessoes SET status='FECHADO', fechado_em=NOW(3), fechado_por='U1', saldo_esperado_centavos=6000, saldo_contado_centavos=5900, diferenca_centavos=-100 WHERE id='C1';"
fail "movimentar caixa fechado" "INSERT INTO movimentacoes_financeiras (id, site_id, caixa_sessao_id, tipo, direcao, valor_centavos, forma_codigo, registrado_por, registrado_em)
VALUES ('M9','S1','C1','SANGRIA','SAIDA',100,'DINHEIRO','U1',NOW(3));" "Caixa fechado"
fail "reabrir caixa fechado"  "UPDATE caixa_sessoes SET observacao_fechamento='x' WHERE id='C1';" "não pode ser alterado"

echo "== Cancelamento"
ok   "nova entrada e cancelamento" "
INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S03','S1',3,'VE1','ABC1234','CAR','V1','R1',NOW(3),'U1');
UPDATE sessoes_estacionamento SET status='CANCELADA', cancelado_em=NOW(3), cancelado_por='U1', motivo_cancelamento='entrada duplicada' WHERE id='S03';"
fail "cancelar sem motivo"    "INSERT INTO sessoes_estacionamento (id, site_id, numero, veiculo_id, placa, categoria_id, vaga_id, tarifa_regra_id, entrada_em, operador_entrada_id)
VALUES ('S04','S1',4,'VE1','ABC1234','CAR','V1','R1',NOW(3),'U1');
UPDATE sessoes_estacionamento SET status='CANCELADA', cancelado_em=NOW(3), cancelado_por='U1' WHERE id='S04';" "ck_sessoes_cancelada"

echo "== Capacidade"
ok   "admin adiciona 1 vaga de carro" "INSERT INTO vagas (id, site_id, codigo, categoria_id) VALUES ('V4','S1','A-03','CAR');
INSERT INTO capacidade_alteracoes (id, site_id, categoria_id, capacidade_anterior, capacidade_nova, vagas_afetadas, motivo, alterado_por)
VALUES ('CA1','S1','CAR',2,3,JSON_ARRAY('V4'),'ampliação','U1');"
fail "histórico de capacidade imutável" "UPDATE capacidade_alteracoes SET motivo='x' WHERE id='CA1';" "somente inserção"

echo "== Histórico e sincronização"
expect "eventos auditados automaticamente" "SELECT COUNT(DISTINCT acao) >= 10 FROM historico_atividades;" "1"
expect "motivo gravado no histórico" "SELECT motivo FROM historico_atividades WHERE acao='pagamento.estornado';" "cliente pagou em dobro"
fail "alterar histórico"      "UPDATE historico_atividades SET acao='x' LIMIT 1;" "somente inserção"
fail "apagar histórico"       "DELETE FROM historico_atividades LIMIT 1;" "retenção"
ok   "outbox"                 "INSERT INTO sync_estado (site_id) VALUES ('S1');
INSERT INTO sync_outbox (event_id, site_id, tipo, agregado_tipo, agregado_id, payload, ocorrido_em)
VALUES ('E1','S1','ticket.aberto','ticket','S01','{}',NOW(3)),('E2','S1','ticket.fechado','ticket','S01','{}',NOW(3));"
fail "evento duplicado"       "INSERT INTO sync_outbox (event_id, site_id, tipo, agregado_tipo, agregado_id, payload, ocorrido_em) VALUES ('E1','S1','x','t','S01','{}',NOW(3));" "uq_outbox_event"
fail "enviado sem data"       "UPDATE sync_outbox SET status='ENVIADO' WHERE event_id='E1';" "ck_outbox_envio"
expect "pendentes no painel"  "SELECT pendentes FROM vw_sync_status WHERE site_id='S1';" "2"

echo
echo "Resultado: $PASS passaram, $FAIL falharam"
[ "$FAIL" -eq 0 ]
