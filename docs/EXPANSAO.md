# Preparação para expansões futuras

Este documento é uma análise da arquitetura atual. **Nada aqui foi implementado.** Para cada expansão, ele mostra:
- o que já existe e serve de base;
- o que precisará ser criado (módulos, APIs, tabelas e interfaces);
- as regras para não quebrar o que já funciona.

A ideia é que cada expansão **acrescente**, sem reescrever o que existe.

## 1. O que a arquitetura atual já oferece

| Base existente | Onde | Serve para |
|----------------|------|-----------|
| **`site_id` em todas as tabelas** (local e nuvem), integrações por estacionamento | `database/local/001_schema.sql`, `database/cloud/*` | Múltiplos estacionamentos |
| **Interfaces de equipamentos**: `PlateReader`, `OccupancySensor`, `Gate`, `TicketPrinter`, hoje com implementação manual ou vazia | `apps/local-server/src/integrations/` | LPR, sensores, cancelas, impressoras |
| **Postos com `tipo`** (hoje `GUICHE`) | tabela `postos` | Totens, entradas/saídas automáticas |
| **Pagamento com `origem` `PRESENCIAL`/`ONLINE`**. O banco já aceita pagamento sem caixa quando é `ONLINE` (`ck_pag_caixa`) | tabela `pagamentos` | Pagamento online |
| **Formas de pagamento por cadastro**: uma nova forma é um `INSERT` | tabela `formas_pagamento` | Pix online, cartão online, vale, convênio |
| **Chave de idempotência** em todo pagamento | `pagamentos.chave_idempotencia` | Notificações repetidas de gateway (webhooks) |
| **Desconto e acréscimo com motivo** na saída; tarifas **especiais** (dia da semana, horário) e versões publicadas imutáveis | `sessoes`, `tarifa_regras` | Descontos, convênios, promoções |
| **Motor de cálculo único e puro** (sem banco, sem relógio) | `packages/calculo` | Mensalistas, convênios, simulações no app |
| **Clientes e veículos do cliente** | `clientes`, `cliente_veiculos` | Planos mensais, notificações |
| **Outbox transacional** (o evento é gravado na mesma transação da mudança) e **detecção por triggers** | `sync_outbox`, `sync_marcas` | Fonte de eventos para notificações, comprovantes, cancelas |
| **`sync_inbox`**: tabela criada para comandos da nuvem → local, **ainda sem uso** | `001_schema.sql` | Pagamento online confirmado, plano vendido no app |
| **Integrações HMAC com escopos** (`sync:ler`, `sync:escrever`) | `apps/cloud-api/src/modules/sync` | Novos escopos: `pagamento:notificar`, `dispositivo:*` |
| **Formato de evento versionado** (`version`) e API pública em `/v1` | `packages/shared/src/sync.ts`, `docs/API-EXTERNA.md` | Evoluir o formato sem quebrar o servidor local antigo |
| **Histórico por triggers**, LGPD (retenção e anonimização), monitoramento | `historico_atividades`, `lgpd_*`, `erros_sistema` | Auditoria e privacidade das novas funções |

### Lacunas que valem para todas as expansões

1. **As interfaces de equipamentos ainda não são chamadas pelos serviços.** `integracoes` está definido, mas `sessoes.service.ts` não usa `cancela.abrir()` nem `impressora.imprimirTicket()`. O primeiro passo de qualquer equipamento é ligar esses pontos depois do COMMIT, nunca dentro da transação: um equipamento lento não pode travar o banco.
2. **Não há cadastro de dispositivos.** A escolha da implementação está fixa no código (`integrations/index.ts`).
3. **Não há consumidores locais de eventos.** A outbox hoje só alimenta a nuvem. Notificações, comprovantes e cancelas precisam ler os mesmos eventos.
4. **A nuvem ainda não manda nada para o local.** O `sync_inbox` existe, mas falta o `pull`.

Resolver essas quatro lacunas (a seção 3) prepara quase todas as expansões.

## 2. Análise por expansão

### 2.1 Sensores de vaga

| Item | O que fazer |
|------|-------------|
| **Interface** | `OccupancySensor` já existe. Acrescentar um modo **por evento**, com `aoMudar(callback)`, além da consulta `estadoDaVaga` |
| **Tabelas** | `dispositivos` (seção 3.1). `vagas.sensor_id` (FK opcional). `leituras_sensor` (vaga, estado, lido_em), com retenção curta, de 30 dias |
| **Módulo** | `modules/dispositivos` (cadastro e saúde) e um adaptador por fabricante em `integrations/<fabricante>/` |
| **Regra** | O sensor **informa**, não decide. A ocupação oficial continua sendo o ticket. Divergências (sensor ocupado sem ticket, ou ticket sem sensor) viram **alerta** no Monitoramento e no mapa de vagas |
| **API local** | `POST /api/v1/dispositivos/:id/leituras` (para sensores que enviam por HTTP), autenticado por dispositivo (seção 3.2) |
| **Compatibilidade** | Sem sensor, tudo continua como hoje (`sensorOcupacaoManual`). A disponibilidade pública já sai de `vagas`, sem mudança na nuvem |

### 2.2 Leitura automática de placas (LPR)

| Item | O que fazer |
|------|-------------|
| **Interface** | `PlateReader` já tem `placa`, `confianca`, `capturadaEm` e `imagemUrl`. Acrescentar `aoLer(callback)` para câmeras que empurram as leituras |
| **Tabelas** | `leituras_placa` (posto, placa, confiança, imagem, sessao_id), com retenção curta e **dado pessoal** (entra na política LGPD e no relatório do titular) |
| **Fluxo** | Leitura com confiança alta abre a tela de entrada **pré-preenchida**. A entrada automática sem operador só acontece com cancela e regra configurável (`configuracoes.lpr_entrada_automatica`). A **mesma** `sessoesService.registrarEntrada` é usada, e as validações de placa continuam valendo |
| **Saída** | A leitura na saída localiza o ticket aberto (`/sessoes/localizar` já busca por placa) |
| **Cuidados** | Placa lida errada não pode cobrar outro cliente. Abaixo de um limite de confiança, sempre há confirmação humana |

### 2.3 Câmeras de monitoramento

| Item | O que fazer |
|------|-------------|
| **Escopo** | Só **referência** a imagens (foto da entrada/saída anexada ao ticket). Gravação contínua fica com o sistema de câmeras (NVR), fora deste sistema |
| **Interface nova** | `CameraSnapshot { capturar(postoId): Promise<{ url, capturadaEm }> }` em `integrations/tipos.ts` |
| **Tabelas** | `sessao_imagens` (sessao_id, momento ENTRADA/SAIDA, caminho, hash), com arquivos numa pasta local (`IMAGENS_DIR`) e não no banco |
| **LGPD** | Imagem com placa ou pessoa é dado pessoal: retenção própria (ex.: 30 dias), fora do backup diário ou com backup separado, e no relatório do titular |
| **Nuvem** | **Nunca** sobe para a API pública |

### 2.4 Cancelas automáticas

| Item | O que fazer |
|------|-------------|
| **Interface** | `Gate.abrir(postoId, motivo)` já existe. Acrescentar `estado()` (aberta, fechada, falha) para o Monitoramento |
| **Onde chamar** | Depois do COMMIT de `registrarEntrada` e de `registrarSaida`, quando o valor estiver quitado. Também por botão "abrir manualmente" com permissão nova (`cancela.abrir`) e motivo obrigatório, registrado no histórico |
| **Tabelas** | `postos.cancela_id` (FK de `dispositivos`) e `aberturas_cancela` (posto, motivo, sessao_id, usuario_id, resultado) |
| **Falha segura** | Cancela sem resposta não desfaz a entrada ou a saída. A operação já gravada fica, e o operador abre a cancela manualmente |
| **Tolerância de saída** | Depois do pagamento, uma janela para sair (já existe a tolerância no cálculo). Passou da janela, a cancela pede um novo cálculo |

### 2.5 Pagamentos online

É a expansão que mais toca o núcleo, mas o banco já está preparado: `origem = 'ONLINE'` dispensa o caixa.

| Item | O que fazer |
|------|-------------|
| **Fluxo** | O app do cliente pede o valor → a **nuvem** cria a cobrança no gateway (Pix/cartão) → o gateway confirma por **webhook na nuvem** → a nuvem grava em `sync_inbox` (nuvem) → o servidor local faz o *pull*, registra o pagamento `ONLINE` com a chave de idempotência da cobrança e devolve o ticket atualizado pela outbox |
| **Por que pela nuvem** | O servidor local não pode receber chamadas da internet (nenhuma porta aberta, §7.1 da arquitetura) |
| **Valor** | O valor vem **do servidor local**. A nuvem não calcula a tarifa sozinha: o local publica um "valor válido até HH:MM" no ticket (nova projeção `cobranca`). Se o cliente pagar depois, a diferença fica pendente para a saída |
| **Tabelas na nuvem** | `cobrancas_online` (ticket, valor, gateway, id externo, status, expira_em), `webhooks_recebidos` (idempotência, assinatura) |
| **Tabelas locais** | Nenhuma nova obrigatória: `pagamentos` com `origem='ONLINE'`, `formas_pagamento` com `PIX_ONLINE` e `CARTAO_ONLINE`, e `pagamentos.autorizacao` com o id do gateway |
| **APIs** | Nuvem: `POST /v1/ticket/cobranca` (o token do ticket autentica) e `POST /webhooks/<gateway>`. Sync: `GET /sync/v1/comandos` e `POST /sync/v1/comandos/:id/resultado` (escopo novo `comandos:ler`) |
| **Relatórios e caixa** | Pagamento online não entra no dinheiro esperado de nenhum caixa (já é assim por `caixa_sessao_id NULL`). Os relatórios precisam de um filtro de origem |
| **Estorno** | O estorno online é pedido ao gateway pela nuvem e confirmado de volta pelo mesmo canal |
| **Segurança** | Segredo do gateway só na nuvem. Webhook com assinatura conferida. O app nunca vê dados do cartão (checkout do gateway) |

### 2.6 Comprovantes digitais

| Item | O que fazer |
|------|-------------|
| **Base** | O ticket encerrado já tem tudo: valor, pagamentos, permanência e tarifa aplicada. O app já mostra o ticket encerrado durante o prazo do link |
| **O que falta** | Número de comprovante sequencial por estacionamento (a tabela `sequencias` já existe), um **hash de conferência** no comprovante e uma projeção `comprovante` para a nuvem |
| **Tabelas** | `comprovantes` (sessao_id, número, emitido_em, hash, enviado_para) |
| **APIs** | `GET /v1/ticket/comprovante` (PDF/HTML, autenticado pelo token) e no painel `GET /sessoes/:id/comprovante` para reimpressão |
| **Fiscal** | Nota fiscal de serviço (NFS-e) é outra integração, por município. Deixe uma interface `EmissorFiscal` e **não** misture com o comprovante |

### 2.7 Notificações

| Item | O que fazer |
|------|-------------|
| **Canais** | Push no app (Web Push com o *service worker* que já existe), e-mail e WhatsApp/SMS por provedor |
| **Gatilhos** | Eventos que já existem na outbox: entrada, aproximação da próxima faixa de cobrança (o motor tem `proximoMinutoDeCobranca`), saída e comprovante. Mais "plano vencendo" para mensalistas |
| **Onde roda** | Na **nuvem**, consumindo os eventos já recebidos. O local não precisa de internet para operar |
| **Tabelas na nuvem** | `inscricoes_push` (ticket ou cliente, endpoint, chaves, expira_em), `notificacoes` (tipo, destino, status, tentativas) |
| **Consentimento (LGPD)** | Push só com opt-in no app, vinculado ao ticket e apagado com ele. E-mail e WhatsApp só para clientes cadastrados com consentimento registrado (nova coluna `clientes.consentimentos` JSON com data) |
| **Interface** | `CanalNotificacao { enviar(destino, mensagem) }` na nuvem, com uma implementação por provedor |

### 2.8 Impressoras térmicas

| Item | O que fazer |
|------|-------------|
| **Interface** | `TicketPrinter.imprimirTicket` já existe. Acrescentar `imprimirComprovante` e `imprimirFechamentoCaixa` |
| **Técnica** | ESC/POS por USB ou rede. O QR Code vai como comando nativo da impressora (o link já existe em `acesso.link`) |
| **Onde chamar** | Depois do COMMIT. Falha de impressão gera aviso na tela e um botão "imprimir de novo" (`POST /sessoes/:id/imprimir`), sem desfazer a operação |
| **Tabelas** | `postos.impressora_id` (FK de `dispositivos`) |
| **Detalhe** | A impressora fica no posto (guichê), não no servidor. Uma impressora USB ligada ao PC do caixa precisa de um **agente** no PC do caixa (seção 3.3) |

### 2.9 Planos mensais (mensalistas)

| Item | O que fazer |
|------|-------------|
| **Tabelas** | `planos` (nome, categoria, preço mensal, regras de uso: horário, dias, vaga fixa), `assinaturas` (cliente, plano, início, fim, status, dia de vencimento), `assinatura_veiculos` (placas autorizadas, reaproveitando `cliente_veiculos`), `faturas_assinatura` (competência, valor, pago_em, pagamento_id) |
| **Sessão** | Nova `modalidade = 'MENSALISTA'`: o CHECK `ck_sessoes_modalidade` aceita um valor a mais (migração aditiva). A entrada consulta se a placa tem assinatura ativa; a saída cobra zero dentro das regras do plano e cobra o excedente fora delas |
| **Motor** | O cálculo recebe um "contexto de plano" opcional. Sem plano, o resultado é **idêntico** ao atual, o que os testes de cenário já garantem |
| **Vaga** | Vaga fixa usa `sessoes.vaga_id`, com uma regra na escolha da vaga livre: a vaga reservada para mensalista não é oferecida a avulsos |
| **Cobrança** | A fatura mensal é paga no caixa (pagamento sem ticket: `pagamentos.sessao_id` hoje é obrigatório, então é preciso `fatura_id` alternativo e um CHECK de exatamente um dos dois) ou online (seção 2.5) |
| **Relatórios** | Receita de mensalidades separada da avulsa |
| **Permissões** | `plano.gerenciar` e `assinatura.gerenciar` |

### 2.10 Descontos

| Item | O que fazer |
|------|-------------|
| **Já existe** | Desconto manual na saída, com motivo e permissão; tarifas especiais por dia e horário |
| **Falta** | Descontos **cadastrados**: convênio (loja parceira valida o ticket), cupom ou código, primeira hora grátis para clientes de um estabelecimento |
| **Tabelas** | `descontos` (tipo: percentual, valor fixo ou minutos grátis; validade; limite de uso; quem pode aplicar), `sessao_descontos` (sessão, desconto, valor aplicado, aplicado_por, origem: caixa, convênio ou app) |
| **Motor** | Os descontos entram como **etapa final** do cálculo, depois da tarifa, com a ordem documentada. O detalhamento mostra cada desconto (o `detalharTarifa` já monta linhas) |
| **Convênio** | Um tablet na loja parceira com usuário de perfil "convênio", com uma única permissão: `desconto.validar` |
| **Compatibilidade** | O `descontoCentavos` manual continua funcionando e passa a ser gravado também como uma linha de `sessao_descontos` do tipo `MANUAL` |

### 2.11 Múltiplos estacionamentos

| Item | O que fazer |
|------|-------------|
| **Já existe** | `site_id` em tudo. Na nuvem, cada estacionamento é uma integração própria com o seu segredo, e o app do cliente é um só para todos (o slug identifica o estacionamento) |
| **Modelo recomendado** | **Um servidor local por estacionamento.** Cada unidade opera sozinha sem internet, que é o princípio do sistema. A visão consolidada fica na **nuvem** |
| **Nuvem** | Portal da rede: `contas` (empresa), `contas_sites` e `usuarios_portal` com login próprio. Relatórios consolidados a partir de projeções **financeiras agregadas** (por dia, forma e categoria), nunca dados pessoais. É preciso um evento novo, `resumo.diario`, e um escopo `sync:resumos` |
| **Servidor local** | Nada muda no modelo: `obterSiteAtual()` continua a ser **o** estacionamento do servidor. Um servidor com várias unidades exigiria trocar `obterSiteAtual()` (116 usos) por um site vindo do usuário ou do posto. Não recomendado |
| **Tarifas da rede** | Uma tabela modelo publicada no portal e enviada às unidades pelo `sync_inbox`. Cada unidade **aceita** a tabela e a publica localmente, mantendo a regra de que a tarifa vigente é a publicada no servidor local |
| **Usuários** | Um funcionário por unidade, como hoje. O gerente da rede usa o portal |

## 3. Peças comuns (fazer antes, uma vez)

### 3.1 Cadastro de dispositivos

```text
dispositivos (id, site_id, posto_id NULL, tipo SENSOR|LPR|CAMERA|CANCELA|IMPRESSORA,
              fabricante, modelo, endereco, configuracao JSON, ativo,
              ultimo_contato_em, ultimo_estado, ultimo_erro)
```

- `integrations/index.ts` passa a montar a implementação por dispositivo a partir dessa tabela. Sem cadastro, valem as implementações manuais de hoje.
- O Monitoramento ganha um cartão **Dispositivos**, com os que estão sem contato.

### 3.2 Autenticação de dispositivos

Equipamentos não fazem login de funcionário. É preciso um **token por dispositivo** (só o hash no banco, como os outros tokens), enviado num cabeçalho próprio, com permissões mínimas: um sensor só envia leituras.

Seguir o padrão de `exigirPermissao`, com um middleware `autenticarDispositivo(tipo)`.

### 3.3 Agente do posto (opcional)

Impressora USB e alguns leitores ficam no PC do caixa, não no servidor. Um agente pequeno no PC do caixa:
- se autentica como dispositivo;
- recebe pedidos do servidor local (fila por posto, consultada pelo agente);
- fala com o equipamento.

Sem agente, impressoras de rede e câmeras IP funcionam direto do servidor.

### 3.4 Consumidores de eventos locais

Um *dispatcher* que lê os mesmos eventos da outbox depois do COMMIT e chama os assinantes: impressora, cancela, comprovante.

Regras:
- cada assinante tem tentativas e registro de falha próprios (tabela `entregas_evento`: evento, assinante, status, tentativas);
- falha de um assinante nunca atrasa a sincronização nem os outros.

### 3.5 Comandos da nuvem para o local

Implementar o `pull` do `sync_inbox`:

| Peça | Como |
|------|------|
| **Nuvem** | `sync_comandos` (id ULID, site, tipo, payload, criado_em, status) |
| **Local** | O worker de sync consulta `GET /sync/v1/comandos` (HMAC, escopo `comandos:ler`), grava em `sync_inbox` e processa **idempotente pelo id** |
| **Resultado** | Volta para a nuvem pela outbox |
| **Primeiros tipos** | `pagamento.online.confirmado`, `tabela.modelo.recebida`, `assinatura.vendida` |

## 4. Regras de compatibilidade

1. **Só migrações aditivas.** Coluna nova é `NULL` ou tem `DEFAULT`; tabela nova não muda as antigas. Um CHECK que ganha valores (por exemplo, `modalidade`) é ampliado, nunca restringido.
2. **O cálculo sem a novidade é idêntico ao atual.** Planos, convênios e descontos cadastrados entram como entradas opcionais do motor. Os testes de cenário de `packages/calculo` precisam continuar passando sem alteração.
3. **Equipamento nunca dentro da transação.** Chamadas a dispositivos acontecem depois do COMMIT. Falha de equipamento gera aviso, não desfaz a operação.
4. **O servidor local é a fonte da verdade.** A nuvem não decide valor nem estado do ticket. Ela pede, e o local confirma (seção 3.5).
5. **Eventos versionados.** Um payload que muda ganha `version + 1`, e a nuvem aceita as duas versões até todos os servidores locais atualizarem.
6. **API pública só cresce.** Campos novos são opcionais. Uma mudança que quebra vai para `/v2`, com `/v1` mantida.
7. **Dado pessoal novo entra na LGPD no mesmo dia:**
   - imagens e leituras de placa: retenção, relatório do titular e anonimização;
   - consentimentos de notificação.
8. **Permissão nova para cada ação nova** (`cancela.abrir`, `plano.gerenciar`, `desconto.validar`...). O teste `auditoria-permissoes.test.ts` falha se uma rota nova ficar sem proteção.
9. **Monitoramento acompanha.** Cada integração nova aparece em `monitoramento.service.ts`, com nível e ação recomendada.

## 5. Ordem sugerida

| Etapa | Entrega | Depende de |
|-------|---------|-----------|
| 1 | Peças comuns: dispositivos, autenticação de dispositivo, consumidores de eventos, comandos da nuvem (seção 3) | — |
| 2 | Impressora térmica e comprovante digital | 1 |
| 3 | Descontos cadastrados e convênios | — (só local) |
| 4 | Planos mensais | 3 (o motor recebe contextos opcionais) |
| 5 | Pagamento online | 1 (comandos), 2 (comprovante) |
| 6 | Notificações | 5 (avisar sobre pagamento), consentimentos |
| 7 | Cancelas, LPR e sensores | 1, 3 (quem passa grátis), 4 (mensalista entra direto) |
| 8 | Portal da rede (múltiplos estacionamentos) | eventos de resumo |

Câmeras com foto no ticket podem entrar junto com a etapa 7.

## 6. O que **não** mudar agora

- Não trocar o modelo "um servidor local por estacionamento".
- Não mover cálculo de tarifa para a nuvem.
- Não abrir portas do servidor local para a internet. Tudo o que vem de fora chega pela nuvem (seção 3.5).
- Não criar tabelas de expansões antes de começar cada uma. As tabelas sem uso envelhecem (o `sync_inbox` é o exemplo). Este documento é o plano; as migrações nascem com o código.
