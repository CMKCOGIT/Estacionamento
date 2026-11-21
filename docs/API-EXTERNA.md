# API externa (nuvem)

A API externa (`apps/cloud-api`) fica num servidor na internet e tem dois papéis:

1. **Receber** os dados que o servidor local do estacionamento sincroniza.
2. **Disponibilizar** a consulta individual do ticket para o cliente, pelo app "Meu Ticket" (PWA).

O servidor local continua sendo a **fonte da verdade**. A nuvem guarda só uma cópia pronta para consulta (*modelo de leitura*) com o que o cliente pode ver.

```
Servidor local ──HTTPS + HMAC──▶ /sync/v1 ──▶ banco da nuvem ◀── /v1 ◀──HTTPS── App do cliente
 (fila de eventos,                 (só integrações                  (só leitura,
  envio automático)                 autenticadas)                    token do ticket)
```

Especificação técnica das rotas (OpenAPI 3.1): [`apps/cloud-api/openapi.yaml`](../apps/cloud-api/openapi.yaml).

## Rotas

| Método | Rota | Quem usa | Autenticação | O que faz |
|--------|------|----------|--------------|-----------|
| GET | `/saude` | Monitoramento do provedor | — | `{"status":"ok"}` ou 503 se o banco estiver fora |
| GET | `/v1/sites/{slug}/disponibilidade` | App do cliente | — | Vagas livres e total, por categoria |
| GET | `/v1/sites/{slug}/tarifas` | App do cliente | — | Tabela de preços **em vigor** (uma tabela agendada só aparece na data) |
| GET | `/v1/ticket` | App do cliente | `Authorization: Ticket <token>` | O ticket do token: placa, entrada, tempo, valor acumulado, tarifa, situação |
| POST | `/sync/v1/push` | Servidor local | HMAC (escopo `sync:escrever`) | Recebe um lote de até 100 eventos. Lote vazio = sinal de vida |
| POST | `/sync/v1/snapshot` | Servidor local | HMAC (escopo `sync:escrever`) | Carga completa do estado atual, em partes |
| POST | `/sync/v1/conferir` | Servidor local | HMAC (escopo `sync:ler`) | Conferência entre os bancos: o que está diferente, ausente ou sobrando na nuvem ([SINCRONIZACAO.md](SINCRONIZACAO.md#6-evitar-inconsistências-entre-os-bancos)) |
| GET | `/sync/v1/status` | Servidor local | HMAC (escopo `sync:ler`) | Último `seq` aplicado e último contato |

Comportamento geral:
- **Somente leitura para clientes.** Qualquer `POST`, `PUT`, `PATCH` ou `DELETE` fora de `/sync/v1` recebe **405**. Em `/sync/v1`, sem a credencial do estacionamento a resposta é **401**.
- **Nenhuma rota administrativa, operacional ou financeira.** Abrir ou fechar ticket, registrar pagamento, mexer no caixa, mudar tarifas, ver usuários ou relatórios: tudo isso só existe no servidor local, na rede do estacionamento. O cliente pode **consultar**, nunca alterar.
- **Erros** sempre no formato `{"erro": {"codigo": "...", "mensagem": "..."}}`, sem detalhes internos. Códigos:
  - `NAO_ENCONTRADO`;
  - `NAO_AUTORIZADO` (401);
  - `PROIBIDO` (403);
  - `CONFLITO` (409);
  - `REQUISICAO_INVALIDA` (400/405/413);
  - `MUITAS_TENTATIVAS` (429, com `Retry-After`);
  - `INDISPONIVEL` (503).
- **Identificação da requisição:** toda resposta tem `X-Request-Id`. O mesmo id aparece no log e no registro, o que facilita investigar um problema relatado.

## Dados públicos: o que pode e o que não pode sair do estacionamento

A única saída de dados do servidor local para a internet são as **projeções públicas** (`apps/local-server/src/sync/projecoes.ts`). A nuvem valida cada campo (`sync.schemas.ts`) e **descarta qualquer campo a mais**: mesmo que um dia o servidor local enviasse algo indevido por engano, isso não seria gravado.

| Dado | Vai para a nuvem? | Quem vê | Observação |
|------|:-----------------:|---------|------------|
| Nome, endereço, telefone e slug do estacionamento | Sim | Qualquer pessoa | Tela "Vagas e preços" |
| Vagas: total e livres por categoria | Sim | Qualquer pessoa | Sem a identificação de cada vaga |
| Tabela de preços publicada (textos prontos) | Sim | Qualquer pessoa | Inclui as tarifas especiais e quando valem |
| Placa, nº do ticket, categoria e vaga do ticket | Sim | **Só quem tem o link** daquele ticket | A placa é o único dado pessoal na nuvem (LGPD) |
| Entrada, saída e situação do ticket | Sim | Só quem tem o link | |
| Regra de preço gravada no ticket | Sim | Só quem tem o link | Usada para calcular o valor acumulado na hora da consulta |
| Valor final e itens do cálculo | Sim | Só quem tem o link | Só depois da saída |
| **Total** já pago do ticket | Sim | Só quem tem o link | Só a soma, nunca o detalhe de cada pagamento |
| Hash do token do link | Sim | Ninguém | O token em si **nunca** sai do celular do cliente |
| Prazo do link (política de encerramento) | Sim | Só quem tem o link | |
| Formas de pagamento, troco, cada pagamento | **Não** | — | |
| Caixa (abertura, fechamento, sangria, saldo) | **Não** | — | |
| Operadores, funcionários, usuários, senhas, permissões | **Não** | — | |
| Cadastro de veículos e clientes, histórico de estadias | **Não** | — | |
| Relatórios e faturamento | **Não** | — | |
| Auditoria, motivos de cancelamento ou estorno, descontos | **Não** | — | |

O que o app recebe em `GET /v1/ticket` está descrito em `TicketPublico` (`packages/shared/src/publico.ts`). A resposta não traz identificadores internos (ids do banco), nem dados de outro ticket.

## Acesso do cliente: token do link

- **Token:** 32 bytes aleatórios (base64url, 43 caracteres), gerado na entrada. Não tem relação com o número do ticket, a placa ou a vaga, então não dá para "adivinhar o próximo".
- **Só o hash fica guardado:** o banco local e o da nuvem guardam apenas o SHA-256 do token. Quem copiar o banco não consegue montar links.
- **Onde o token trafega:** vai depois do `#` no link (não aparece em logs nem no *Referer*) e no cabeçalho `Authorization: Ticket <token>`. Na URL, ele é ignorado.
- **Respostas e limites:**
  - token inexistente, alterado, revogado ou expirado recebe a **mesma resposta 404**;
  - limites por minuto: 30 consultas **que falham** por IP (quem tenta adivinhar links), 12 consultas por ticket e um teto de 1200 por IP. Consultas que dão certo não contam no limite por IP, porque muitos clientes podem chegar pelo mesmo IP (NAT da operadora de celular, wi-fi do estacionamento);
  - a resposta usa `Cache-Control: no-store`.
- **Encerramento:** depois da saída, o link vale pelo prazo definido no painel (Configurações → Link do cliente). Detalhes em [PWA.md](PWA.md).

## Recebimento dos dados do servidor local (`/sync/v1`)

### Autenticação das integrações (HMAC)

Cada estacionamento tem uma **integração** (credencial) com escopos. Cada requisição leva quatro cabeçalhos:

| Cabeçalho | Conteúdo |
|-----------|----------|
| `X-Integracao-Id` | Id da credencial (26 caracteres) |
| `X-Timestamp` | Horário em segundos UNIX |
| `X-Nonce` | 32 caracteres hexadecimais aleatórios, novos a cada requisição |
| `X-Assinatura` | `v1=<hex>` = HMAC-SHA256(segredo, texto) |

O texto assinado tem seis linhas:

```
v1
<timestamp>
<nonce>
<MÉTODO>
<rota, ex.: /sync/v1/push>
<sha256 hex do corpo>
```

A função `textoParaAssinar` (`packages/shared/src/sync.ts`) é a mesma nos dois lados.

A nuvem recusa (sempre com a mesma resposta 401):
- cabeçalhos ausentes;
- assinatura errada, inclusive com o corpo alterado depois de assinado;
- horário com mais de 5 minutos de diferença;
- nonce repetido (requisição capturada e reenviada);
- credencial revogada.

Também recusa com 403:
- falta do escopo exigido pela rota;
- `siteId` que não é o da credencial. Um estacionamento nunca escreve nos dados de outro.

**O segredo não fica guardado no banco.** Ele é derivado de `SYNC_CHAVE_MESTRA` (variável de ambiente secreta da API), do id e da versão da credencial: HMAC-SHA256. Um vazamento do banco não entrega segredos.

**Troca de segredo sem parar o sistema:** `girar` gera uma versão nova, e a anterior continua valendo por 24h.

### Gerenciar credenciais

No servidor da API externa:

```bash
npm run integracao -w @estacionamento/cloud-api -- criar --nome "Estacionamento Centro"
```

```bash
npm run integracao -w @estacionamento/cloud-api -- listar
```

```bash
npm run integracao -w @estacionamento/cloud-api -- girar --id <ID>
```

```bash
npm run integracao -w @estacionamento/cloud-api -- revogar --id <ID>
```

1. `criar` mostra `SYNC_INTEGRACAO_ID` e `SYNC_SECRET` **uma vez**.
2. Copie as duas linhas para o `.env` do servidor local, junto com `CLOUD_API_URL=https://...`.
3. Sem `--site`, a credencial fica presa ao estacionamento que a usar primeiro. Isso também fica no registro.

### Eventos e carga completa

O servidor local grava cada alteração e o evento correspondente **na mesma transação** (`sync_outbox`). O worker (`apps/local-server/src/sync/worker.ts`) envia a fila:

| Situação | O que o worker faz |
|----------|--------------------|
| Primeira conexão, nuvem sem os dados (409) ou "Ressincronizar" no painel | **Carga completa** (`/snapshot`): estacionamento, vagas, tabelas de preço visíveis e tickets abertos ou com link válido, lidos numa fotografia consistente do banco e enviados em partes de 150 tickets. No fim, a nuvem apaga o que não existe mais no local |
| Alterações | **Lotes** de até 100 eventos ou 450 KB, em ordem de `seq` |
| Nenhuma alteração | Lote vazio a cada 15 s (**sinal de vida**). O app do cliente avisa quando o estacionamento para de enviar dados |
| Falha de rede | Novas tentativas com espera crescente e variação aleatória: 2 s, 4 s... até **1 min** |
| Nuvem com erro | Espera crescente até **5 min** |
| Credencial recusada | Espera de 1 a 10 min, com mensagem clara no painel |
| Evento recusado | *Dead-letter*: status `REJEITADO`, com o motivo, no painel (Configurações) |

Nada se perde: a operação do estacionamento nunca espera a nuvem, e o que não foi enviado fica na fila.

**Cada evento carrega o estado atual do que mudou** (a projeção pública do ticket, das vagas, da tabela ou do estacionamento), não só a diferença. A aplicação na nuvem tem três regras:
- **Idempotente:** o `eventId` fica em `sync_aplicados`. O mesmo evento de novo é confirmado como "repetido" e não é aplicado outra vez.
- **Sem retroceder:** cada item guarda o `seq` do último evento aplicado. Um evento mais antigo que isso é "superado" e não desfaz o estado novo.
- **Por evento:** um evento inválido é rejeitado sozinho, com o motivo, e os outros do lote são aplicados.

> **Diferença em relação ao plano inicial** (ARQUITETURA §6.3, regra 2): a nuvem **não** recusa lotes com "buracos" na sequência. O `seq` é um contador automático do MySQL, que pula números quando uma transação é desfeita (por exemplo, numa nova tentativa após *deadlock*), e duas transações podem terminar fora de ordem. Exigir sequência contínua travaria a sincronização. Por isso:
> - eventos carregam o estado completo;
> - a nuvem aplica cada item só se o `seq` dele for maior que o já aplicado;
> - o worker só lê eventos com mais de 1 s, para dar tempo às transações em andamento.

| Evento (`tipo`) | `dados.tipo` | Quando |
|-----------------|--------------|--------|
| `ticket.aberto`, `ticket.pagamento`, `ticket.pagamento_estornado`, `ticket.fechado`, `ticket.cancelado`, `ticket.token_revogado`, `ticket.atualizado` | `ticket` | Entrada, pagamento, estorno, saída, cancelamento, novo link, placa corrigida |
| `vagas.disponibilidade` | `disponibilidade` | Toda mudança de ocupação ou de vagas |
| `tarifa.publicada` | `tabela_tarifa` | Tabela publicada, para agora ou para uma data futura |
| `tarifa.arquivada` | `tabela_tarifa_arquivada` | Agendamento cancelado |
| `site.atualizado` | `site` | Mudança na política do link do cliente |
| `ticket.alterado`, `*.corrigido` | (o do item) | Alteração detectada no banco local; correção pedida pela conferência |
| `ticket.removido` | `ticket_removido` | O ticket não existe mais no local (ex.: banco restaurado): a nuvem apaga |

## Registro de erros e requisições

| Onde | O que fica |
|------|-----------|
| **Log** (saída padrão, coletado pelo provedor) | Toda requisição: id, método, rota **sem a query string**, status e tempo. Erros com detalhes técnicos. O cabeçalho `Authorization` e cookies nunca são registrados |
| **Tabela `registro_api`** | As requisições **relevantes** (veja abaixo). Mantida por `DIAS_REGISTRO` dias (padrão 30) |

O que vai para `registro_api`:
- lotes e cargas completas recebidos, com as contagens;
- vínculo de credencial ao estacionamento;
- eventos rejeitados, com o motivo;
- autenticação recusada, com o motivo;
- limite de consultas excedido (só a primeira recusa de cada janela, para não encher o registro num ataque);
- requisição inválida;
- erros internos.

O registro **nunca** guarda:
- token, segredo, assinatura ou corpo da requisição;
- IP em claro (só um HMAC do IP com `CHAVE_REGISTRO`, para notar repetições sem identificar a pessoa).

Consulta útil (no MySQL da nuvem):

```sql
SELECT ocorrido_em, nivel, tipo, status, rota, detalhes
  FROM registro_api WHERE nivel <> 'info' ORDER BY id DESC LIMIT 50;
```

## HTTPS e segurança

- **HTTPS:** em produção (`NODE_ENV=production`), o HTTPS é obrigatório. GET em HTTP é redirecionado, o resto é recusado, e o HSTS fica ligado. O provedor entrega o certificado: use `CONFIAR_PROXY=1`.
- **Origem do app:** a API não inicia se `PWA_ORIGENS` tiver endereço sem `https://`.
- **Servidor local:** também recusa iniciar com `CLOUD_API_URL` sem `https://` em produção.
- **Cabeçalhos:**
  - `Content-Security-Policy: default-src 'none'`;
  - `Referrer-Policy: no-referrer`;
  - sem `X-Powered-By`;
  - CORS só para o endereço do app, só GET e só o cabeçalho `Authorization`. As rotas `/sync` não têm CORS e não são usadas pelo navegador.
- **Limites:**

  | Rota | Consultas por minuto por IP | Tamanho máximo do corpo |
  |------|----------------------------|-------------------------|
  | `/v1/ticket` | 30 | — |
  | `/sync` | 240 | Push: 512 KB. Snapshot: 2 MB |

- **Banco:** SQL sempre com parâmetros, e toda entrada validada com Zod.
- **Retenção:**

  | Dado | Prazo |
  |------|-------|
  | Ticket na nuvem | Apagado 30 dias após a saída |
  | Nonces | 10 minutos |
  | Confirmações de sincronização | 30 dias |
  | Registro de requisições | 30 dias |

  No servidor local, os eventos enviados e o histórico de envios saem após 30 dias. **Apagar na nuvem nunca apaga no local.**

## Estrutura para integrações futuras

- `src/modules/index.ts`: cada módulo declara o caminho (sempre versionado, `/v1`, `/sync/v1`...) e o tipo de acesso: `PUBLICO` (só leitura, CORS do app) ou `INTEGRACAO` (HMAC + escopo).
- `integracoes`: credenciais com `tipo` (`SERVIDOR_LOCAL`, `PARCEIRO`) e `escopos`. A rota exige o escopo dela com `autenticarIntegracao('<escopo>')`.
- `sync_inbox` (já existe no banco local): itens criados na nuvem para o local buscar. Previsto para mensalistas e Pix online.

Para criar uma integração nova:
1. Crie `src/modules/<nome>`, com as rotas protegidas por `autenticarIntegracao('<escopo>')`.
2. Acrescente o escopo em `integracoes/credenciais.ts`.
3. Registre o módulo em `modules/index.ts` com um caminho versionado (ex.: `/parceiros/v1`).
4. Documente as rotas neste arquivo e em `openapi.yaml`.

Se a nova versão do formato dos eventos quebrar a compatibilidade, use `versao + 1`, e a nuvem aceita as duas versões durante a transição.

## Publicar

1. **Banco:** MySQL do provedor, sem porta exposta na internet.

   ```bash
   npm run db:migrar -w @estacionamento/cloud-api
   ```

2. **Variáveis da API:**
   - `NODE_ENV=production`;
   - `DB_*`;
   - `PWA_ORIGENS=https://<app>`;
   - `CONFIAR_PROXY=1`;
   - `SYNC_CHAVE_MESTRA=<32+ caracteres aleatórios, secreto>`;
   - opcionais: `CHAVE_REGISTRO`, `DIAS_REGISTRO`.
3. **Compilar e iniciar:**

   ```bash
   npm run build -w @estacionamento/cloud-api
   ```

   ```bash
   npm start -w @estacionamento/cloud-api
   ```

4. **Credencial de cada estacionamento:** `npm run integracao -- criar`. Depois, no `.env` do servidor local:
   - `CLOUD_API_URL=https://<api>`;
   - `SYNC_INTEGRACAO_ID`;
   - `SYNC_SECRET`;
   - `PUBLIC_PWA_URL=https://<app>`.
5. **Conferir:** no painel do estacionamento, **Configurações → Sincronização com a nuvem** deve mostrar "Em dia".

## Testes

| Onde | O que cobre |
|------|-------------|
| `apps/cloud-api/tests/sync.test.ts` (16) | Carga completa e vínculo da credencial; evento aplicado, repetido e atrasado; rejeição individual; campos a mais descartados; token revogado; tabela futura; sinal de vida e status; limpeza pela carga completa; autenticação (sem credencial, token de cliente, segredo errado, corpo alterado, horário velho, *replay*, revogada, outro estacionamento, sem escopo, troca de segredo); JSON inválido; nada de escrita fora de `/sync`; registro sem token, segredo nem IP; `X-Request-Id` |
| `apps/cloud-api/tests/publico.test.ts` (14) | Consulta do ticket, dados públicos, segurança do token, CORS, HTTPS |
| `apps/local-server/tests/integracao/sync.test.ts` (8) | Worker contra uma nuvem de teste que confere a assinatura: carga completa só com dados públicos; ordem e confirmação dos eventos; sinal de vida; nuvem fora do ar (fila, espera crescente, recuperação); *dead-letter*; 409 → carga completa; credencial recusada; "Ressincronizar" |
