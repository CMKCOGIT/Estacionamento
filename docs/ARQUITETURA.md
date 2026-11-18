# Arquitetura Técnica — Sistema de Estacionamento

> Status: **v0.2: requisitos confirmados**. Nenhum código foi implementado ainda.
> Itens marcados com ⚠️ ainda precisam de definição.

---

## 0. Escopo da versão 1 (confirmado)

| Tema | Na v1 | Deixar preparado para o futuro |
|------|-------|--------------------------------|
| Estabelecimentos | 1 estacionamento | Vários (`site_id` em todas as tabelas desde já) |
| Acesso do cliente | **Sem conta**: link individual ou QR Code com token seguro | Solicitação de cadastro de mensalista |
| O que o cliente vê | Disponibilidade geral de vagas, tabela de tarifas, o próprio ticket (placa, entrada, permanência, valor acumulado) | — |
| Pagamento | **Só presencial**, registrado pelo funcionário: dinheiro, Pix, débito, crédito | Pix online pelo PWA |
| Entrada e saída | Manual: o funcionário digita a placa e associa a uma vaga | Sensores de ocupação, câmera com leitura de placa (LPR), cancelas, impressora térmica |
| Servidor local | **Windows** | — |
| Nuvem | Provedor a escolher pelo custo-benefício (ver §4.2) | Mais capacidade, vários estabelecimentos |

---

## 1. Arquitetura geral

```mermaid
flowchart LR
  subgraph LOCAL["🅿️ Estacionamento (Windows, rede local)"]
    ADM["Painel Admin<br/>(React SPA)"]
    LS["Servidor Local<br/>Node.js + Express"]
    LDB[("MySQL Local<br/>fonte da verdade")]
    SW["Worker de Sincronização"]
    INT["Integrações<br/>(v1: manual; futuro: LPR,<br/>sensores, cancela, impressora)"]
    ADM -- HTTP/LAN --> LS
    INT -.-> LS
    LS --> LDB
    SW --> LDB
  end

  subgraph CLOUD["☁️ Nuvem"]
    API["API Externa<br/>Node.js + Express"]
    CDB[("MySQL Nuvem<br/>dados para consulta")]
    PWA["PWA Clientes<br/>(arquivos estáticos)"]
    API --> CDB
  end

  CEL["📱 Celular do cliente<br/>(abre o link/QR do ticket)"]

  SW -- "HTTPS, sempre de dentro para fora<br/>(push de eventos)" --> API
  CEL --> PWA
  CEL -- HTTPS/JSON --> API
```

### Decisões principais

| # | Decisão | Motivo |
|---|---------|--------|
| D1 | **O MySQL local é a fonte da verdade** de entradas, saídas, vagas, tarifas e pagamentos. | A operação não pode depender da internet. |
| D2 | **Na v1, a nuvem só recebe dados e responde consultas.** Ela recebe eventos do local e não cria nenhum dado de negócio. | Não há escrita nos dois lados, então não há conflito. O fluxo inverso (*inbox*) fica preparado para mensalistas e Pix online. |
| D3 | **Só o servidor local inicia a conexão**, de dentro para fora. | Não precisa abrir porta no roteador nem ter IP fixo. O servidor local nunca fica exposto à internet. |
| D4 | **Fila de eventos gravada na mesma transação** (Outbox) e **envio repetido seguro** (idempotente). | Nenhum dado se perde quando a internet cai, e reenviar não gera duplicidade. |
| D5 | **O cálculo de tarifa é uma função única no pacote `shared`**, usada pelo servidor local e pela nuvem. | O valor acumulado mostrado no PWA é exatamente o que o caixa vai cobrar. |
| D6 | **O cliente acessa o ticket com um token aleatório de 256 bits**, colocado no final do link, depois do `#` (não é enviado ao servidor). | Não precisa de login, o token não aparece em logs e é impossível de adivinhar (§7.3). |
| D7 | **As integrações ficam atrás de interfaces** (*ports/adapters*). | Na v1 tudo é manual; LPR, cancela e impressora entram depois sem mexer nas regras de negócio. |
| D8 | **`site_id` em todas as tabelas e em todos os eventos** desde o início. | Vários estabelecimentos sem precisar migrar o modelo de dados. |
| D9 | **A nuvem guarda o mínimo de dados pessoais**: não tem cadastro de cliente na v1. | LGPD e menos risco se a nuvem for invadida. |

---

## 2. Responsabilidade de cada componente

### 2.1 Painel Administrativo (`apps/admin-web`)
- React SPA servida pelo próprio servidor local (`http://<pc-servidor>:8080`), acessível pelos computadores da rede do estacionamento.
- **Entrada**: digitar a placa e escolher a vaga. O sistema gera o ticket e **mostra o QR Code e o link** para o cliente.
- **Saída**: buscar por placa ou ticket, ver o valor calculado, registrar **um ou mais pagamentos** (dinheiro, Pix, débito, crédito; é possível dividir entre formas) e calcular o troco.
- Também: caixa (abertura, fechamento e sangria), cadastro de vagas e tipos, tabela de tarifas, usuários e perfis, relatórios e **status da sincronização**.

### 2.2 Servidor Local (`apps/local-server`)
- API REST com Express, sem acesso pela internet.
- Concentra as regras de negócio: tickets, vagas, tarifas, pagamentos e caixa.
- Grava cada alteração e o evento correspondente na `sync_outbox` **na mesma transação**.
- Gera o token do ticket e guarda **apenas o hash** dele.
- Roda como **serviço do Windows**: inicia sozinho com o PC e reinicia se travar.

### 2.3 Worker de Sincronização
- Serviço do Windows **separado** da API: uma falha na sincronização não derruba a operação.
- **Push** dos eventos para a nuvem, em lotes e em ordem.
- **Pull** da inbox: já vem implementado, mas fica desligado na v1 (será usado por mensalistas e Pix online).
- Status no painel: pendências, último envio com sucesso e erros.

### 2.4 Camada de Integrações (`apps/local-server/src/integrations`)
Interfaces definidas desde a v1, com implementação manual ou vazia:

| Interface | v1 | Futuro |
|-----------|----|--------|
| `PlateReader` | o operador digita a placa | câmera LPR envia a placa lida |
| `OccupancySensor` | vaga escolhida pelo operador | sensor informa vaga ocupada ou livre |
| `Gate` | não faz nada | abre a cancela depois da entrada ou do pagamento |
| `TicketPrinter` | QR mostrado na tela | impressão térmica (ESC/POS) |

Os dispositivos chamam os **mesmos serviços** que o painel usa. A regra de negócio fica num lugar só.

### 2.5 MySQL Local
- Schema completo: operação, financeiro, usuários, auditoria e sincronização.
- Instalado como serviço do Windows, escutando só em `127.0.0.1`.

### 2.6 API Externa (`apps/cloud-api`)
- `/sync/*`: recebe eventos do servidor local (autenticação HMAC).
- `/v1/*`: endpoints públicos do PWA:
  - `GET /v1/sites/:slug/disponibilidade`
  - `GET /v1/sites/:slug/tarifas`
  - `GET /v1/ticket` (token no header `Authorization: Ticket <token>`)
- Calcula o **valor acumulado no momento da consulta**, com a função compartilhada (D5), a tarifa sincronizada e o horário de entrada.

### 2.7 MySQL Nuvem
- Dados preparados para consulta (*read model*): `sites`, `disponibilidade`, `tarifas`, `tickets_publicos` (hash do token, placa, entrada, saída, status, vaga, tarifa), mais `sync_applied`, `sync_state` e `inbox` (futuro).

### 2.8 PWA (`apps/pwa`)
- Telas: **Início** (vagas livres e tarifas) e **Meu ticket** (placa, entrada, tempo de permanência atualizando a cada segundo, valor acumulado e status).
- O token é lido do `#` do link e guardado no `localStorage` do celular, para o cliente reabrir pelo atalho sem escanear de novo.
- Mostra “atualizado há X min”, para o cliente saber se a informação pode estar desatualizada.
- **Ticket ainda não sincronizado** (internet do estacionamento caída): o link também leva, depois do `#`, um pequeno pacote **assinado** com `placa`, `entrada` e `tarifa_id`. Com ele, o PWA já mostra o tempo e uma estimativa marcada como “prévia” até a nuvem receber o ticket.

---

## 3. Fluxo de comunicação

### 3.1 Entrada do veículo e acesso do cliente

```mermaid
sequenceDiagram
  participant OP as Operador
  participant LS as Servidor Local
  participant DB as MySQL Local
  participant W as Worker
  participant API as API Nuvem
  participant C as Cliente (PWA)

  OP->>LS: POST /tickets {placa, vaga_id}
  LS->>LS: gera token (32 bytes aleatórios)
  LS->>DB: BEGIN; INSERT ticket (token_hash); UPDATE vaga; INSERT outbox x2; COMMIT
  LS-->>OP: ticket + QR (https://app/t#<token>)
  OP-->>C: cliente escaneia o QR na tela
  W->>API: POST /sync/push [ticket.aberto, vaga.ocupada]
  API-->>W: 200 {last_applied_seq}
  C->>API: GET /v1/ticket (Authorization: Ticket <token>)
  API->>API: sha256(token) → busca → calcula valor acumulado
  API-->>C: {placa, entrada, permanencia, valor_atual, status}
```

### 3.2 Saída e pagamento
1. O operador busca o ticket e o servidor local calcula o valor final com a função compartilhada.
2. O operador registra um ou mais pagamentos. Quando a soma cobre o valor, o ticket é fechado e a vaga liberada.
3. Eventos gerados: `pagamento.registrado` (×N), `ticket.fechado` e `vaga.liberada`.
4. O PWA passa a mostrar “Pago / Encerrado”. O token **expira 24h após a saída** (⚠️ ajustável).

### 3.3 Quando a internet cai
1. A operação continua normalmente e os eventos se acumulam na outbox.
2. O worker tenta de novo com espera crescente: 5s → 10s → 30s → 1min → 5min (máximo).
3. Quando a conexão volta, envia os pendentes em lotes e em ordem.
4. O cliente vê os dados mais recentes que a nuvem tem. Um ticket ainda não sincronizado aparece como “prévia” (§2.8).

---

## 4. Tecnologias recomendadas

### 4.1 Stack

| Camada | Tecnologia | Observação |
|--------|-----------|------------|
| Runtime | **Node.js 22 LTS** | Mesma versão nos dois servidores |
| Linguagem | **TypeScript** | Tipos compartilhados |
| Backend | **Express 5** | |
| Validação | **Zod** | Schemas no `shared` |
| Banco | **MySQL 8.4 LTS** (local e nuvem) | |
| Acesso ao banco | **Knex.js** + `mysql2` | Migrations e SQL explícito |
| Frontend | **React 18 + Vite** + Tailwind | Painel e PWA |
| PWA | **vite-plugin-pwa** (Workbox) | |
| QR Code | `qrcode` (gerado no servidor local, funciona sem internet) | |
| Senhas dos funcionários | **argon2id** | |
| Logs | **pino** + rotação de arquivos | |
| Serviço Windows | **WinSW** (ou NSSM) | Mais confiável no Windows que o PM2 |
| Backup local | `mysqldump` + **Agendador de Tarefas do Windows** | |
| Instalador local | Script PowerShell (`infra/local/install.ps1`) | Instala os serviços, cria o banco e roda as migrations |
| Nuvem | **Docker Compose** (API + Caddy com HTTPS automático) | Funciona igual em qualquer provedor |
| Testes | Vitest + Supertest | |
| Monorepo | npm workspaces | |

### 4.2 Hospedagem na nuvem (custo-benefício)

O volume é pequeno: um estacionamento, poucas requisições por minuto. Por isso o custo de uma VPS pequena compensa mais que serviços gerenciados.

| Opção | Como fica | Prós | Contras |
|-------|-----------|------|---------|
| **A. VPS com Docker** (ex.: Hostinger VPS, Vultr ou Magalu Cloud, com região no Brasil) | API + MySQL + Caddy numa VPS de 1–2 vCPU / 2–4 GB | **Menor custo**, baixa latência no Brasil, controle total | Backup e atualizações por nossa conta (automatizados com scripts) |
| B. VPS + MySQL gerenciado (ex.: DigitalOcean, Aiven) | API na VPS, banco gerenciado | Backup automático, alta disponibilidade do banco | Custo maior, sem região no Brasil em alguns provedores |
| C. PaaS (Railway, Render) | Deploy pelo Git | Mais simples de operar | Custo cresce rápido; MySQL nem sempre oferecido |

**Recomendação:** começar pela **opção A**, com backup diário do MySQL enviado para um armazenamento de objetos externo (ex.: Backblaze B2 ou Cloudflare R2) e monitoramento de disponibilidade (ex.: UptimeRobot). Como tudo roda em Docker, migrar para a opção B depois é simples.

A perda temporária da nuvem **não afeta a operação**: o servidor local continua sendo a fonte da verdade e pode reenviar tudo (§6.3, regra 7).

> ⚠️ Confirmar preços e planos no momento da contratação, porque mudam com frequência.

---

## 5. Estrutura de pastas

```
Estacionamento/
├── apps/
│   ├── local-server/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── db/{migrations,seeds}/
│   │   │   ├── modules/
│   │   │   │   ├── auth/            # login dos funcionários
│   │   │   │   ├── usuarios/
│   │   │   │   ├── vagas/           # vagas e tipos (carro, moto…)
│   │   │   │   ├── tickets/         # entrada/saída, token, QR
│   │   │   │   ├── tarifas/
│   │   │   │   ├── pagamentos/      # formas de pagamento, pagamento dividido
│   │   │   │   ├── caixa/
│   │   │   │   └── relatorios/
│   │   │   ├── integrations/        # PlateReader, OccupancySensor, Gate, TicketPrinter
│   │   │   │   └── manual/          # implementações da v1
│   │   │   ├── sync/{outbox,pusher,puller,worker}.ts
│   │   │   ├── middlewares/
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   └── tests/
│   ├── admin-web/src/{pages,components,services,hooks}
│   ├── cloud-api/
│   │   ├── src/
│   │   │   ├── db/migrations/
│   │   │   ├── modules/
│   │   │   │   ├── sync/            # /sync/push, /sync/status, /sync/snapshot
│   │   │   │   └── publico/         # disponibilidade, tarifas, ticket
│   │   │   ├── projections/         # aplica cada evento no read model
│   │   │   ├── middlewares/
│   │   │   ├── app.ts
│   │   │   └── server.ts
│   │   └── tests/
│   └── pwa/
│       ├── public/{icons,manifest}
│       └── src/{pages,components,services}
├── packages/
│   └── shared/src/
│       ├── events/                  # contratos dos eventos (Zod + tipos)
│       ├── tarifa/                  # cálculo de tarifa (função única)
│       ├── dto/
│       └── utils/                   # placa (antiga e Mercosul), moeda, datas
├── infra/
│   ├── docker-compose.dev.yml       # MySQL local + MySQL nuvem para desenvolvimento
│   ├── cloud/{Dockerfile,docker-compose.yml,Caddyfile,backup.sh}
│   └── local/{install.ps1,winsw/,backup.ps1}
├── docs/ARQUITETURA.md
├── .env.example
├── package.json
└── tsconfig.base.json
```

---

## 6. Regras de comunicação e sincronização

### 6.1 Quem escreve cada dado

| Dado | Quem escreve | Na nuvem |
|------|--------------|----------|
| Tickets, vagas, ocupação | Local | Só leitura |
| Tarifas e configuração do estacionamento | Local | Só leitura |
| Pagamentos e caixa | Local | **Não vai** (a nuvem só recebe o status “pago” do ticket) |
| Usuários e auditoria | Local | Não vai |
| *(futuro)* Solicitação de mensalista, Pix online | Nuvem (inbox) | O local busca, decide e devolve o resultado pelo push |

### 6.2 Eventos da v1

| Evento | Payload principal |
|--------|-------------------|
| `site.atualizado` | nome, slug, endereço, horário de funcionamento |
| `tarifa.publicada` | tabela completa versionada (`tarifa_id`, regras) |
| `vagas.disponibilidade` | totais e livres por tipo (enviado no máximo a cada 10s) |
| `ticket.aberto` | `ticket_id`, `token_hash`, placa, entrada, vaga, `tarifa_id` |
| `ticket.atualizado` | troca de vaga, correção de placa |
| `ticket.fechado` | saída, valor final, status `pago` |
| `ticket.cancelado` | motivo |
| `ticket.token_revogado` | novo `token_hash` (quando o cliente precisa de um novo QR) |

Formato:

```json
{
  "event_id": "01JD3...ULID",
  "site_id": "01JD0...",
  "seq": 1042,
  "type": "ticket.fechado",
  "version": 1,
  "occurred_at": "2026-11-18T14:03:22.511Z",
  "aggregate": { "type": "ticket", "id": "01JD2..." },
  "payload": { "saida": "...", "valor_centavos": 1800, "status": "pago" }
}
```

### 6.3 Regras
1. **Atomicidade**: a alteração de negócio e o evento são gravados na mesma transação MySQL.
2. **Ordem**: envio por `seq` crescente, contado por `site_id`. A nuvem recusa um lote com buraco na sequência e informa o último `seq` aplicado.
3. **Idempotência**: a nuvem registra o `event_id` em `sync_applied`. Um evento repetido é ignorado e confirmado.
4. **Lotes**: até 100 eventos ou 512 KB por requisição.
5. **Frequência**: o worker é acordado quando surge um evento novo, e verifica também a cada 15s.
6. **Tentativas**: espera crescente com variação aleatória (*jitter*). Erro de validação vai para a *dead-letter* e gera alerta no painel.
7. **Ressincronização completa** (*snapshot*): pelo painel, o servidor local reenvia o estado atual completo. Usada na implantação, ao trocar de provedor ou para recuperar a nuvem.
8. **Horários**: sempre vindos do servidor local e gravados em **UTC**. Regras de tarifa (diária, período noturno) usam o fuso `America/Sao_Paulo`.
9. **Dinheiro**: sempre em **centavos inteiros**, nunca em ponto flutuante.
10. **Versão do formato**: mudança que quebra compatibilidade cria `version + 1`, e a nuvem aceita as duas versões durante a transição.
11. **Retenção**: eventos enviados são apagados da outbox local após 30 dias. Tickets públicos são apagados da nuvem 30 dias após a saída (⚠️ ajustável).

### 6.4 Endpoints de sincronização

| Método | Rota | Função |
|--------|------|--------|
| `POST` | `/sync/push` | Recebe um lote e responde `{ last_applied_seq }` |
| `GET` | `/sync/status` | Último `seq` aplicado na nuvem |
| `POST` | `/sync/snapshot` | Recebe a carga completa por partes |
| `GET` / `POST` | `/sync/pull`, `/sync/ack` | *(futuro)* inbox |

---

## 7. Estratégia de segurança

### 7.1 Servidor local (Windows)
- API acessível **só pela rede local**: regra no Firewall do Windows restrita à sub-rede do estacionamento e **nenhuma porta aberta no roteador**.
- MySQL em `127.0.0.1`, com usuário de aplicação de privilégios mínimos e a senha do `root` guardada à parte.
- Os serviços rodam com uma conta Windows sem privilégio de administrador.
- Login dos funcionários com argon2id, bloqueio após 5 tentativas e sessão que expira após inatividade.
- **Perfis de acesso (RBAC)**: `admin` (tudo), `operador` (entrada, saída, pagamento, caixa próprio), `financeiro` (relatórios). Cancelamento, estorno e alteração de tarifa só para `admin`, com justificativa.
- **Auditoria** (`audit_log`, sem permissão de alteração pela aplicação): cancelamentos, estornos, mudanças de tarifa, abertura e fechamento de caixa, logins.
- **Backup diário** pelo Agendador de Tarefas: guardar 7 diários e 4 semanais, e mandar uma cópia criptografada (AES-256) para fora do PC (pen drive, outro PC ou armazenamento na nuvem).

### 7.2 Canal de sincronização
- HTTPS (TLS 1.2+) e, por estabelecimento, `site_id` e segredo próprio (guardado no `.env` local, nunca no Git).
- Assinatura de cada requisição: `X-Signature = HMAC-SHA256(segredo, timestamp + método + rota + sha256(corpo))`.
- A nuvem recusa requisições com mais de 5 minutos de diferença de horário, contra o reaproveitamento de requisições capturadas (*replay*).
- O segredo pode ser trocado sem parar o sistema (a nuvem aceita o atual e o anterior durante a troca).
- A nuvem confere se o `site_id` dos eventos é o mesmo da credencial, para um estacionamento não escrever nos dados de outro.

### 7.3 Token do ticket (acesso do cliente)
- **32 bytes aleatórios** (`crypto.randomBytes`), em base64url com 43 caracteres. É impossível de adivinhar por tentativa.
- **Só o hash SHA-256** fica guardado (local e nuvem). Quem copiar o banco não consegue montar links válidos.
- Vai **depois do `#`** no link (`https://app.exemplo.com.br/t#<token>`). O navegador não envia essa parte ao servidor, então ela não aparece em logs, proxies nem no cabeçalho *Referer*. O PWA manda o token no header `Authorization`.
- Dá acesso **somente** àquele ticket e apenas para leitura.
- Expira 24h após a saída. O operador pode **revogar e gerar um QR novo** se o cliente perder ou compartilhar o link.
- Limite de requisições por IP no `/v1/ticket`, e resposta idêntica para token inválido ou expirado.
- O pacote de “prévia” (§2.8) é **assinado** pelo servidor local com Ed25519. O PWA verifica a assinatura com a chave pública, então ninguém consegue forjar uma prévia.

### 7.4 API externa e banco na nuvem
- `helmet`, CORS liberado só para o domínio do PWA, limite de requisições, validação de toda entrada com Zod e SQL sempre com parâmetros (*prepared statements*).
- MySQL **sem porta exposta**: só na rede interna do Docker.
- Firewall da VPS liberando só as portas 80/443 e SSH com chave (sem senha), mais `fail2ban` e atualizações automáticas de segurança.
- Backup diário criptografado num armazenamento externo, com teste de restauração periódico.

### 7.5 LGPD
- Na v1 a nuvem **não guarda nome, CPF nem telefone**: só placa e dados do ticket, apagados após o prazo de retenção.
- Uma página de privacidade no PWA explica quais dados são mostrados e por quanto tempo ficam guardados.

### 7.6 PWA
- Só HTTPS, *Content-Security-Policy* restritiva e `Referrer-Policy: no-referrer`.
- O cache offline guarda só o app, a disponibilidade e as tarifas. O ticket fica no `localStorage` e tem um botão “esquecer este ticket”.

---

## 8. Pontos em aberto ⚠️

1. **Como o QR chega ao cliente na v1**, já que não há impressora: (a) o cliente escaneia na tela do operador ou num monitor voltado para ele; (b) o operador envia o link por WhatsApp, manualmente; (c) as duas opções.
2. **Regras da tabela de tarifas**: fração inicial, valor por hora, tolerância, diária máxima, pernoite, preço diferente por tipo de veículo (carro, moto)? Vão definir o modelo de `tarifas` e a função de cálculo.
3. **Prazos**: o token expira 24h após a saída e os tickets ficam 30 dias na nuvem. Esses valores servem?
4. **Domínio** para o PWA e a API (ex.: `app.seuestacionamento.com.br`).
