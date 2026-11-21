# LGPD — proteção de dados pessoais

Como o sistema atende à Lei Geral de Proteção de Dados (Lei 13.709/2018).

> Este documento descreve o que o **sistema** faz. Ele não substitui a análise jurídica do estacionamento, que é o **controlador** dos dados e responde por eles. Revise os prazos e bases legais com o seu contador ou advogado.

## 1. Inventário de dados pessoais

| Dado | Titular | Onde fica | Finalidade | Base legal (art. 7º) | Retenção |
|------|---------|-----------|------------|----------------------|----------|
| Placa, categoria, marca, modelo e cor do veículo | Cliente | Servidor local | Controle de entrada e saída, cobrança | Execução de contrato (V) | Anonimizada depois de **60 meses** sem visita (configurável) |
| Horários, vaga e valores das estadias | Cliente | Servidor local | Cobrança; registros financeiros | Contrato (V); obrigação legal (II) | Valores: guardados sem a placa |
| Pagamentos (forma, valor, troco) | Cliente | Servidor local | Registros financeiros e fiscais | Obrigação legal (II) | Guardados (sem ligação com a placa depois da anonimização) |
| Placa, horários, valor e total pago do ticket | Cliente | Nuvem (cópia) | Consulta do próprio ticket no app | Contrato (V) | Acesso termina N h após a saída; registro apagado em **30 dias** |
| Hash do token do link | — | Local e nuvem | Acesso individual ao ticket | — (não identifica ninguém) | Com o ticket |
| Cadastro de cliente (nome, CPF/CNPJ, telefone, e-mail) | Cliente cadastrado | Servidor local | Mensalistas e convênios (futuro) | Contrato (V) | Anonimizado com o veículo |
| Nome, CPF, telefone, e-mail, cargo e login do funcionário | Funcionário | Servidor local | Acesso ao sistema e responsabilização | Contrato de trabalho (V); obrigação legal (II) | Enquanto houver vínculo + prazos trabalhistas (gestão pelo RH) |
| IP e navegador do login no painel | Funcionário | Servidor local | Segurança da conta | Legítimo interesse (IX) | **180 dias** depois do fim da sessão |
| Histórico de atividades (inclui a placa nas operações) | Funcionário e cliente | Servidor local | Auditoria, prevenção a fraude | Legítimo interesse (IX); exercício de direitos (VI) | **60 meses**. A placa sai antes, se for anonimizada |
| Solicitações dos titulares (nome, contato, placa) | Titular que pede | Servidor local | Atender e provar o atendimento | Obrigação legal (II) | Identificação apagada **6 meses** após a conclusão; protocolo e hash ficam |
| Tickets guardados no celular | Cliente | O próprio celular | Reabrir o ticket | Contrato (V) | Até o fim do acesso ("Esquecer" apaga antes) |

**Não são coletados:**
- nome, CPF ou telefone do cliente avulso, que só precisa da placa;
- dados de localização ou biometria;
- cookies de rastreamento.

## 2. Minimização

- **O cliente avulso** é identificado só pela placa. O app não pede nome, CPF, telefone nem login.
- **A nuvem** recebe só a projeção pública do ticket (veja [API-EXTERNA.md](API-EXTERNA.md#dados-públicos-o-que-pode-e-o-que-não-pode-sair-do-estacionamento)). Ficam no local:
  - formas de pagamento;
  - operadores;
  - caixa;
  - cadastros.
- **Respostas da API** trazem só o necessário para cada tela:
  - a lista de funcionários não traz CPF, telefone nem e-mail;
  - CPF de cliente aparece mascarado no relatório;
  - a API pública não traz ids internos.
- **Logs** sem dados pessoais. Ficam ocultos ou mascarados:
  - placa;
  - CPF;
  - e-mail;
  - telefone;
  - query string;
  - SQL com valores.

  Veja [SEGURANCA.md](SEGURANCA.md#11-proteção-de-informações-pessoais).
- **No celular**, o app apaga a placa assim que o acesso ao ticket termina.

## 3. Controle de acesso

| Quem | Acessa |
|------|--------|
| Operador | Tickets e caixa do dia a dia, conforme as permissões |
| Financeiro | Relatórios e caixa |
| Administrador | Tudo, inclusive **Privacidade (LGPD)** (permissão `lgpd.atender`) e o histórico |
| Cliente | Só o próprio ticket, pelo link, e só leitura |
| API externa | Só o que o servidor local enviou, sem acesso ao banco local |

Toda consulta de dados de um titular, exportação ou anonimização fica registrada no histórico, com o usuário, o IP e o motivo, mas sem a placa (só um hash).

## 4. Política de retenção (automática)

Configurável no painel, em **Privacidade (LGPD) → Retenção e encarregado**. A rotina roda **todo dia** sozinha e também pelo botão "Aplicar retenção agora" (`privacidade.service.ts` → `executarRetencao`).

| Item | Padrão | O que acontece |
|------|--------|----------------|
| Placas sem visita | 60 meses | Anonimização completa (veja a seção 6). Pula veículos com ticket aberto |
| Acessos ao painel (IP, navegador) | 180 dias | Sessões encerradas são apagadas |
| Histórico de atividades | 60 meses | Registros mais antigos são apagados |
| Solicitações concluídas | 6 meses | Nome, contato, placa e descrição do titular são apagados; protocolo, datas e hash ficam |

Fora da rotina:

| Onde | Dado | Prazo |
|------|------|-------|
| Nuvem | Tickets | Apagados 30 dias após a saída |
| Nuvem | Registro de requisições | 30 dias |
| Fila de sincronização | Eventos enviados | 30 dias |

Apagar na nuvem nunca apaga no servidor local.

## 5. Direitos dos titulares (art. 18) — procedimento

Painel → **Privacidade (LGPD) → Solicitações dos titulares**:

1. **Receber.** O pedido pode chegar pelo caixa, pelo contato do encarregado (que aparece no app do cliente) ou por qualquer canal. **Registre** a solicitação: tipo, nome e contato para a resposta, placa e descrição. O sistema gera o **protocolo** (`LGPD-2026-0001`) e o **prazo de 15 dias** (art. 19, II). Os vencidos aparecem destacados.
2. **Confirmar a identidade.** Antes de entregar ou apagar dados, confirme que quem pede é o titular, por exemplo com o documento do veículo (CRLV). Não entregue dados de terceiros.
3. **Atender** conforme o tipo:

| Pedido | Como atender no sistema |
|--------|-------------------------|
| Confirmação e acesso (I, II) | "Dados de um titular" → consultar a placa → relatório com tudo o que existe sobre ela |
| Portabilidade (V) | "Baixar dados (portabilidade, JSON)" → entregar o arquivo ao titular |
| Correção (III) | Veículos → editar (placa digitada errada, marca, modelo, cor). Ticket aberto acompanha |
| Anonimização ou eliminação (IV, VI) | "Anonimizar esta placa", com o protocolo como motivo (seção 6) |
| Com quem compartilhamos (VII) | O relatório traz a seção "compartilhamento": só a nuvem do próprio estacionamento (app do cliente), enquanto o link vale |
| Revogação de consentimento (IX) e oposição | O sistema não usa consentimento como base. Registre e responda explicando as bases legais (estão no relatório), ou anonimize se não houver base que justifique manter |

4. **Concluir:** marque **Atendida** ou **Indeferida** com a resposta dada. Ela é obrigatória para concluir, e a solicitação concluída não pode ser reaberta (registre uma nova). Tudo fica no histórico.

**Quando indeferir ou adiar:**
- **Veículo no estacionamento:** a anonimização é recusada pelo sistema, porque os dados são necessários para a cobrança.
- **Obrigações fiscais:** os valores pagos não são apagados. Depois da anonimização, eles não identificam mais ninguém.

**Funcionários:** os pedidos de funcionários sobre os próprios dados são atendidos pelo RH. No painel, a ficha do funcionário (Funcionários) mostra e corrige os dados. A eliminação respeita os prazos trabalhistas.

## 6. O que a anonimização faz

Fica em `privacidade.service.ts` → `anonimizar`, numa única transação. A placa é trocada por um **pseudônimo aleatório** (ex.: `AN7KQ2M9XP`), que não é derivado da placa e não permite voltar a ela, em:
1. cadastro do veículo (marca, modelo, cor e observações apagados);
2. todos os tickets dessa placa;
3. **histórico de atividades**, que é redigido (só a rotina de retenção pode fazer isso: trigger `trg_historico_bu`);
4. fila de sincronização;
5. **nuvem:** o link do cliente é revogado e o ticket é apagado de lá (`ticket.removido`);
6. clientes ligados só a esse veículo: nome vira "Titular anonimizado", e documento, telefone, e-mail e observações são apagados.

**Ficam:**
- valores, formas de pagamento e caixa, por obrigação fiscal e contábil, sem ligação com a pessoa;
- o registro "lgpd.anonimizacao" no histórico, com quem fez, quando e o motivo, só com o hash da placa.

**Não pode ser desfeita.** O painel pede o motivo e uma confirmação.

## 7. Encarregado (art. 41)

Cadastre nome e contato em **Privacidade (LGPD) → Retenção e encarregado**. O contato é enviado à nuvem e aparece na tela **Privacidade** do app do cliente, junto com:
- os direitos do titular;
- as finalidades do tratamento;
- o prazo de resposta.

## 8. Segurança (art. 46)

Veja [SEGURANCA.md](SEGURANCA.md):
- senhas com argon2id;
- tokens aleatórios com só o hash guardado;
- HTTPS;
- permissões por função;
- histórico de auditoria;
- validação de toda entrada;
- consultas parametrizadas;
- logs sem dados pessoais;
- backups criptografados.

## 9. Incidente de segurança (art. 48)

1. **Conter:**
   - troque as senhas afetadas;
   - revogue a credencial da nuvem (`npm run integracao -- revogar`, depois `criar`);
   - gire a `SYNC_CHAVE_MESTRA` se ela vazou;
   - gere novos links para os tickets abertos ("novo link").
2. **Apurar** pelo histórico de atividades e pelo `registro_api`, usando o `X-Request-Id` para seguir uma requisição.
3. **Avaliar o risco** aos titulares. Se houver risco ou dano relevante, comunique a **ANPD** e os titulares em prazo razoável (a ANPD orienta até 3 dias úteis), com:
   - a natureza dos dados;
   - os titulares afetados;
   - as medidas tomadas;
   - os riscos;
   - o contato do encarregado.
4. **Registrar** o incidente e as medidas tomadas.

**O que limita o dano:**
- a nuvem só tem placas de tickets recentes e o hash dos tokens, sem pagamentos, cadastros ou funcionários;
- quem copiar o banco não consegue montar links nem descobrir senhas.

## 10. Testes

`apps/local-server/tests/integracao/privacidade.test.ts`:
- só `lgpd.atender` vê dados de titulares;
- o relatório não traz dados de outros titulares, operadores nem IPs;
- a consulta é registrada sem a placa;
- a portabilidade gera um arquivo JSON;
- a anonimização é recusada com o veículo no estacionamento;
- depois da saída, a placa some do veículo, dos tickets, do histórico e da fila; o link é revogado, o ticket sai da nuvem e os valores pagos continuam;
- as solicitações têm protocolo, prazo de 15 dias, resposta obrigatória e não podem ser reabertas;
- a retenção anonimiza placas antigas, apaga acessos ao painel e redige solicitações;
- o contato do encarregado vai para o app;
- os logs não têm placa, CPF, e-mail nem SQL;
- as respostas de erro não trazem a query string nem detalhes do banco.
