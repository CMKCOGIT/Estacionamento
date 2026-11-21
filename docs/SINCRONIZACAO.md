# Sincronização servidor local → servidor externo

O **servidor local é a fonte principal** dos registros operacionais: tickets, vagas, tarifas, pagamentos e caixa. A nuvem recebe só uma cópia do que o app do cliente pode ver (o que sai e o que nunca sai está em [API-EXTERNA.md](API-EXTERNA.md#dados-públicos-o-que-pode-e-o-que-não-pode-sair-do-estacionamento)).

A sincronização nunca bloqueia a operação. Entrada, saída, pagamento e caixa funcionam igual com ou sem internet. O que muda fica numa **fila no banco local** e vai para a nuvem quando der.

```
 alteração (serviço)  ─┐  mesma transação   ┌─► sync_outbox (fila) ──► worker ──HTTPS+HMAC──► /sync/v1/push
 alteração (direto     │ ─────────────────► │                              │
  no banco, script)  ──┘   trigger: marca   └─► sync_marcas ──► worker gera o evento
                                                                         │
                                            a cada 10 min: /sync/v1/conferir ◄─┘ (corrige diferenças)
```

## 1. Detectar alterações

| Camada | Como | Onde |
|--------|------|------|
| **Serviços** (caminho normal) | Cada operação grava, **na mesma transação**, um evento com o estado atual do item: `ticket.aberto`, `ticket.pagamento`, `ticket.fechado`, `ticket.cancelado`, `ticket.token_revogado`, `ticket.atualizado`, `vagas.disponibilidade`, `tarifa.publicada`, `tarifa.arquivada`, `site.atualizado` | `apps/local-server/src/sync/outbox.ts` |
| **Banco** (rede de segurança) | 15 triggers marcam em `sync_marcas` qualquer alteração relevante, **mesmo feita por fora do sistema** (correção manual, script, importação, código futuro que esqueça o evento) | `database/local/012_deteccao_alteracoes.sql` |
| **Vagas livres** | Conferidas a cada 15 s: se o estado atual for diferente do último enviado, sai um evento novo. Assim não há uma linha disputada por todas as entradas ao mesmo tempo | `worker.ts` → `vigiarDisponibilidade` |

Tabelas vigiadas pelos triggers:
- `sessoes_estacionamento`;
- `sessao_tokens`;
- `pagamentos` (só o total pago vai para a nuvem);
- `vagas` e `categorias_veiculo`;
- `tabelas_tarifa` (publicação e arquivamento);
- `sites`;
- `configuracoes` (política do link do cliente).

Quando o serviço grava o evento, ele apaga a marca do mesmo item, porque o evento já cobre a alteração. **A marca que sobra é uma alteração sem evento.** O worker gera o evento com o estado atual, com origem `DETECCAO`, e apaga a marca na mesma transação.

## 2. Fila de sincronização (`sync_outbox`)

| Coluna | Para quê |
|--------|----------|
| `event_id` | **Identificador único** (ULID) do evento: é a base da idempotência na nuvem |
| `seq` | Ordem de envio (contador do banco) |
| `tipo`, `agregado_tipo`, `agregado_id` | O que mudou |
| `payload` | Estado atual do item (projeção pública), não só a diferença |
| `origem` | `APLICACAO` (serviço), `DETECCAO` (trigger) ou `CONFERENCIA` (correção) |
| `status` | `PENDENTE`, `ENVIADO` ou `REJEITADO` (*dead-letter*) |
| `resultado_nuvem` | O que a nuvem fez: `APLICADO`, `REPETIDO`, `SUPERADO` ou `REJEITADO` |
| `tentativas`, `proxima_tentativa_em`, `ultimo_erro` | **Controle de tentativas** de cada evento |
| `ocorrido_em`, `enviado_em` | Quando aconteceu e quando a nuvem confirmou |

## 3. Envio automático (worker)

O worker roda dentro do servidor local, isolado (uma falha nele nunca derruba a API). Ele liga sozinho quando o `.env` tem `CLOUD_API_URL`, `SYNC_INTEGRACAO_ID` e `SYNC_SECRET` (`apps/local-server/src/sync/worker.ts`).

Cada ciclo (a cada 3 s, ou logo em seguida se ainda houver trabalho):

1. **Detecção:** converte as marcas em eventos (até 100 por ciclo).
2. **Vagas livres:** a cada 15 s, envia de novo se mudaram.
3. **Carga completa**, se pendente: na primeira conexão, quando a nuvem responde que não conhece o estacionamento (409), ou em "Ressincronizar" no painel. É uma fotografia consistente do banco, enviada em partes.
4. **Envio da fila:** lotes de até 100 eventos ou 450 KB, em ordem de `seq`. Só entram eventos com mais de 1 s, para dar tempo às transações em andamento. Sem eventos, vai um lote vazio a cada 15 s (**sinal de vida**).
5. **Conferência** com a nuvem: a cada 10 min, só com a fila vazia (veja o item 6).

## 4. Falhas de comunicação, reenvio e retomada automática

| Falha | Como é identificada | O que o worker faz |
|-------|--------------------|--------------------|
| Sem internet, DNS ou conexão recusada | Erro de rede no `fetch` | Espera crescente com variação aleatória: 2 s, 4 s, 8 s... até **1 min** |
| Nuvem lenta | Sem resposta em 20 s | Mesmo tratamento que a falta de rede |
| Nuvem com erro (5xx) ou limite (429) | Status HTTP | Espera crescente até **5 min** (não sobrecarrega quem está se recuperando) |
| Credencial recusada (401/403) | Status HTTP | Espera de 1 a 10 min e mensagem clara no painel ("confira `SYNC_INTEGRACAO_ID` e `SYNC_SECRET`") |
| Nuvem sem os dados do estacionamento (409) | Status HTTP | Agenda a carga completa |
| Lote inválido (400/413) | Status HTTP | Conta tentativas e, depois de 3, os eventos vão para a *dead-letter* |
| Evento recusado pela nuvem | `rejeitados` na resposta | Só ele vai para a *dead-letter* (`REJEITADO`, com o motivo); os outros seguem |

Em toda falha:
- `sync_estado` guarda as falhas seguidas, o último erro e quando aconteceu;
- os eventos na fila ganham `tentativas + 1`, `proxima_tentativa_em` e `ultimo_erro`;
- `sync_execucoes` registra a tentativa que falhou.

**Nada é descartado:** um evento pendente fica na fila até a nuvem confirmar, por quanto tempo for preciso. Quando a conexão volta, a próxima tentativa dá certo e a fila é enviada sozinha, na ordem. No teste, isso levou 7 s depois de a nuvem voltar.

## 5. Sem duplicidade (idempotência)

- **Na nuvem:** cada `event_id` aplicado fica em `sync_aplicados`. Se o mesmo evento chegar de novo (por exemplo, a resposta se perdeu na volta e o worker reenviou), ele é confirmado como `REPETIDO` e **não é aplicado outra vez**.
- **Sem retroceder:** cada item na nuvem guarda o `seq` do último evento aplicado. Um evento mais antigo é `SUPERADO` e não desfaz o estado novo. Como cada evento leva o estado completo do item, a ordem de chegada não deixa a nuvem inconsistente.
- **No local:** a confirmação só muda eventos ainda `PENDENTE`. Confirmar duas vezes não altera nada.
- **Requisição repetida:** cada requisição tem um nonce de uso único, e a nuvem recusa a mesma requisição reenviada (*replay*).

## 6. Evitar inconsistências entre os bancos

| Mecanismo | Protege contra |
|-----------|----------------|
| Evento gravado na **mesma transação** da alteração | Alteração sem evento ou evento sem alteração (ou os dois ficam gravados, ou nenhum) |
| Triggers + marcas | Alteração feita por fora do sistema |
| Estado completo no evento + `seq` por item | Eventos repetidos, atrasados ou fora de ordem |
| Carga completa (*snapshot*) numa fotografia consistente | Nuvem vazia, nova ou restaurada; troca de provedor. No fim, a nuvem apaga o que não existe mais no local |
| **Conferência** a cada 10 min (`/sync/v1/conferir`) | Qualquer diferença que tenha sobrado: dado perdido, alterado ou corrompido na nuvem, falha no meio de uma operação |

**Como funciona a conferência:**
1. O servidor local calcula a "impressão digital" (SHA-256 da forma canônica, `formaDeConferencia`) do estado atual de cada item visível: estacionamento, vagas, tabelas de preço e tickets abertos ou com link válido.
2. A nuvem **remonta cada item a partir do que tem gravado agora**, faz a mesma conta e responde o que está:
   - **diferente**;
   - **ausente**;
   - **sobrando** (lá, mas não aqui).
3. O servidor local, que é a fonte da verdade, corrige:
   - reenvia o estado atual do que está diferente ou ausente (eventos `*.corrigido`, origem `CONFERENCIA`);
   - manda remover o que não existe mais aqui (`ticket.removido`), por exemplo depois de restaurar um backup.

A conferência nunca altera nada na nuvem por conta própria: só aponta as diferenças.

**A nuvem nunca escreve no servidor local.** Se os dois discordarem, vale sempre o local.

## 7. Status de cada sincronização

| Onde | O quê |
|------|-------|
| `sync_outbox` | Status, resultado na nuvem, tentativas e erro de **cada evento** |
| `sync_execucoes` | **Cada sincronização** (envio, carga completa, conferência): início, fim, duração, itens, `seq` inicial e final, status HTTP, erro, detalhes (aplicados, repetidos, superados, recusados, diferenças) e o `X-Request-Id` da nuvem. O mesmo id está no `registro_api` de lá, para seguir uma requisição nos dois bancos |
| `sync_estado` | Situação geral: último sucesso, último contato, falhas seguidas, último erro, última carga completa, última conferência e diferenças encontradas |
| Painel → **Configurações → Sincronização com a nuvem** | A situação geral (em dia, enviando, com falha, desligada), a fila, as recusas, a última conferência, o histórico das últimas 20 sincronizações e o resumo de 30 dias por origem e resultado. Botões **Conferir agora** e **Ressincronizar**, que ficam registrados no histórico de atividades |
| `GET /api/v1/sync/status` | Os mesmos dados, para outros usos |

## 8. Retenção

| Onde | Dado | Prazo |
|------|------|-------|
| Local | Eventos `ENVIADO` e histórico de execuções | Apagados depois de 30 dias |
| Local | Eventos `PENDENTE` e `REJEITADO` | **Nunca são apagados automaticamente** |
| Nuvem | Confirmações (`sync_aplicados`) | 30 dias. Um evento ainda mais antigo reenviado depois disso é barrado pelo `seq` |
| Nuvem | Nonces | 10 minutos |

## Testes

| Arquivo | O que cobre |
|---------|-------------|
| `apps/local-server/tests/integracao/sync.test.ts` (14) | Contra uma nuvem de teste que confere a assinatura: carga completa só com dados públicos; ordem e confirmação; sinal de vida; nuvem fora do ar (fila, espera crescente, recuperação); *dead-letter*; 409 → carga completa; credencial recusada; "Ressincronizar"; ação pelo sistema sem marca sobrando; **alteração direto no banco detectada e enviada**; vagas alteradas direto no banco; resultado por evento e id da requisição; **conferência** (impressão digital igual à da nuvem, correção do diferente, remoção do que sobrou, histórico); **sem internet: tudo funciona, a fila guarda as operações com as tentativas e, na volta, cada evento vai uma vez só** |
| `apps/cloud-api/tests/sync.test.ts` (21) | Aplicação idempotente e sem retroceder, rejeição individual, carga completa, autenticação, **resultado por evento**, **conferência** (igual, diferente, ausente, sobrando; **dado alterado direto no banco da nuvem**), remoção pelo local |
