# Pagamentos e fechamento de caixa

Menu **Caixa** do painel (`/caixa`).

- **Backend:**
  - `apps/local-server/src/modules/financeiro`: consultas, gravação de pagamentos e estorno;
  - `modules/sessoes/caixa.service.ts`: abertura, sangria/suprimento e fechamento;
  - `modules/sessoes/sessoes.service.ts`: recebimento ligado ao ticket.
- **Banco:** `database/local/010_financeiro.sql`, sobre as tabelas `pagamentos`, `movimentacoes_financeiras`, `caixa_sessoes`, `postos` e `formas_pagamento`.

Tudo funciona no servidor local, sem internet.

## Integração com as estadias

Todo pagamento pertence a um **ticket** (`pagamentos.sessao_id`) e a um **caixa** (`caixa_sessao_id`). Ele só pode ser registrado com o ticket **aberto**. Há dois momentos para receber:

| Quando | Como | O que acontece |
|--------|------|----------------|
| **Na saída** | Entrada e saída → Saída | Recebe o valor final, que pode ser dividido em várias formas, e encerra o ticket na mesma transação |
| **Antes da saída** (antecipado ou parcial) | Caixa → Pendentes → **Receber** | O veículo continua no estacionamento. Na saída, cobra-se só o que tiver acumulado depois do pagamento |

O valor em aberto é sempre calculado pelo servidor: valor acumulado agora menos o já pago (ver [CALCULO.md](CALCULO.md)). **Nunca se recebe mais que o valor em aberto.**

## Formas de pagamento

Ficam cadastradas em `formas_pagamento`: dinheiro, Pix presencial, débito e crédito.

| Forma | Regra |
|-------|-------|
| Dinheiro | Aceita "valor recebido" e calcula o troco |
| Pix e cartão | Não aceitam troco |
| Crédito | Aceita parcelas |

## Pagamento concluído, estornado e pendente

| Situação | Significado | Onde ver |
|----------|-------------|----------|
| **Concluído** (`CONFIRMADO`) | Recebido e registrado no caixa | Caixa → Pagamentos |
| **Estornado** | Lançado errado ou em dobro e devolvido. Aparece com quem estornou, quando e o motivo | Caixa → Pagamentos (filtro "Estornados") |
| **Pendente** | Ticket aberto com valor a receber agora. **Parcial** = já pagou uma parte | Caixa → Pendentes, e "A receber agora" no resumo do dia |

**Estorno:**
- só com o ticket **aberto**;
- o valor sai do **caixa aberto de quem estorna** (movimentação `ESTORNO`);
- dinheiro só pode ser estornado se houver esse valor na gaveta;
- o valor volta a ficar pendente no ticket.

Depois que o ticket é encerrado, a conta fica fechada: a soma dos pagamentos é igual ao valor final, e o banco impede o estorno.

## Proteção contra pagamento duplicado

| Situação de erro | Proteção |
|------------------|----------|
| Duplo clique, rede que caiu antes da resposta, tela recarregada e reenviada | Cada operação da tela tem uma **chave única** (`chave_idempotencia`, com índice único no banco). Reenviar a mesma operação **não grava de novo**: devolve o pagamento ou o recibo já registrado. Dez reenvios simultâneos também não duplicam |
| Mesma chave usada em outro ticket ou com outros dados | Recusado ("Esta operação já foi registrada com outros dados") |
| Duas telas recebendo o mesmo ticket ao mesmo tempo | O ticket fica **travado** durante o registro. A segunda tela espera e vê que não há mais valor em aberto |
| Operador lança o mesmo pagamento duas vezes (mesma forma e valor no mesmo ticket em menos de 5 min) | Pede **confirmação explícita**: "Já existe um pagamento de R$ 10,00 em Dinheiro neste ticket…" |
| Receber mais do que o devido | Recusado: no máximo o valor em aberto agora |
| Pagamento chegando enquanto o caixa fecha | O caixa fica travado durante o fechamento. O pagamento espera e é recusado ("Abra o seu caixa"), então o valor esperado do fechamento é exato |

No banco, pagamentos e movimentações **não podem ser alterados nem excluídos**. A única mudança permitida é a do pagamento de concluído para estornado. Movimentações de recebimento e estorno precisam conferir com o pagamento (valor, forma e site).

## Caixa: abertura, sangria, suprimento e fechamento

| Ação | Quem | Regras |
|------|------|--------|
| **Abrir** | `caixa.operar` | Informa o troco inicial. Usa o primeiro guichê livre (cria "Guichê 2"... se todos estiverem em uso). Cada operador tem no máximo um caixa aberto, e cada guichê também |
| **Sangria** | `caixa.sangria` | Retira dinheiro da gaveta (ex.: depósito no cofre). Exige motivo e não pode passar do dinheiro do caixa |
| **Suprimento** | `caixa.sangria` | Coloca troco na gaveta. Exige motivo |
| **Fechar** o próprio | `caixa.operar` | Informa o dinheiro contado. Se houver diferença do esperado, a observação é obrigatória |
| **Fechar o caixa de outro** (esqueceu aberto) | `caixa.supervisionar` | Mesmas regras. Fica registrado quem fechou |

**Dinheiro esperado** = troco inicial + recebimentos em dinheiro + suprimentos − sangrias − estornos em dinheiro. Ele é calculado pelo banco (`vw_caixa_resumo`) a partir das movimentações.

Abertura, fechamento, sangria, suprimento, pagamento e estorno ficam no **histórico de atividades**.

## Consultas

| Consulta | Onde | O que mostra |
|----------|------|--------------|
| **Resumo financeiro diário** | Caixa → Resumo do dia | Indicadores, tabelas e caixas descritos logo abaixo, de qualquer dia (até hoje) |
| **Pagamentos** | Caixa → Pagamentos | Lista por período, forma, situação, placa ou nº do ticket, com o total concluído e o total estornado. Ação **Estornar** |
| **Pendentes** | Caixa → Pendentes | Tickets abertos com valor a receber, acumulado, já pago e a receber. Ação **Receber** |
| **Movimentações do caixa** | Caixa → Movimentações | Histórico por período, tipo e forma, com total de entradas, saídas e saldo |
| **Meu caixa** | Caixa → Meu caixa | Caixa aberto do operador (totais por forma e todas as movimentações) e os caixas fechados hoje |

O **resumo do dia** mostra:
- **total recebido** e **quantidade de pagamentos**;
- **estornos** e o **líquido do dia**;
- troco dado;
- tickets encerrados, quantos saíram sem cobrança e o ticket médio;
- descontos concedidos;
- **valores por forma de pagamento**;
- recebimentos por hora;
- **a receber agora** (pendentes, só no dia de hoje);
- os **caixas do dia**, com a diferença de cada fechamento. "Ver" abre o detalhe do caixa, e o supervisor pode fechar um caixa esquecido aberto.

Os dias são contados no fuso do estacionamento (`FUSO_OFFSET`).

**Como os totais conferem** (os testes garantem):
- **Recebido no dia** = pagamentos registrados no dia, inclusive os estornados depois. É igual à soma das movimentações de recebimento do dia.
- **Estornado no dia** = estornos feitos no dia, igual às movimentações de estorno.
- **Líquido** = recebido − estornado.
- A soma por forma e a soma por hora são iguais ao total recebido.

## Permissões

| Permissão | Libera |
|-----------|--------|
| `pagamento.registrar` | Receber (na saída ou antecipado) e ver os pendentes |
| `pagamento.estornar` | Estornar pagamento de ticket aberto |
| `caixa.operar` | Abrir e fechar o próprio caixa e ver os próprios caixas |
| `caixa.sangria` | Sangria e suprimento |
| `caixa.supervisionar` · `relatorio.financeiro` | Resumo do dia, todos os pagamentos e movimentações, todos os caixas. Só `caixa.supervisionar` fecha o caixa de outro operador |

O modelo "Operador de caixa" recebe, abre e fecha o próprio caixa. O modelo "Financeiro" supervisiona e faz sangria e suprimento.

## API

| Método | Rota | Uso |
|--------|------|-----|
| POST | `/api/v1/sessoes/:id/pagamentos` | Recebe com o veículo no estacionamento: `{ forma, valorCentavos \| null, valorRecebidoCentavos?, chaveIdempotencia, confirmarDuplicidade? }`. Reenvio = 200 com `repetido: true` |
| POST | `/api/v1/sessoes/:id/saida` | Saída com pagamentos. Reenvio da mesma saída = recibo com `repetido: true` |
| POST | `/api/v1/financeiro/pagamentos/:id/estornar` | Estorno com motivo |
| GET | `/api/v1/financeiro/resumo?data=AAAA-MM-DD` | Resumo financeiro do dia |
| GET | `/api/v1/financeiro/pagamentos?de&ate&forma&status&busca&pagina` | Pagamentos e totais |
| GET | `/api/v1/financeiro/pendentes` | Tickets com valor a receber |
| GET | `/api/v1/financeiro/movimentacoes?de&ate&tipo&forma&caixaId&pagina` | Histórico de movimentações e totais |
| GET | `/api/v1/financeiro/caixas?de&ate` · `/financeiro/caixas/:id` | Caixas do período e o detalhe de um caixa |
| POST | `/api/v1/financeiro/caixas/:id/fechar` | Supervisor fecha o caixa de outro operador |
| GET/POST | `/api/v1/caixa/atual` · `/abrir` · `/fechar` · `/movimentar` | Caixa do próprio operador: situação, abertura, fechamento, sangria e suprimento |
