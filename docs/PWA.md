# App do cliente (PWA) e API pública

| Peça | Onde | O que faz |
|------|------|-----------|
| **App do cliente "Meu Ticket"** | `apps/pwa` | App instalável no celular: vagas livres, preços e o próprio ticket |
| **API pública** | `apps/cloud-api` | Só leitura, só `/v1`, hospedada no servidor externo (nuvem) |
| **Banco da nuvem** | `database/cloud` | Modelo de leitura: só o que o app mostra |
| **Contrato** | `packages/shared/src/publico.ts` | Os tipos que a API devolve e o app usa |

```
Celular (Meu Ticket, HTTPS) ──GET /v1──▶ API pública (nuvem, HTTPS) ──▶ banco da nuvem
                                                                          ▲
                              servidor local do estacionamento ───────────┘ (sincronização)
```

O app **nunca fala com o servidor local** nem com o painel. Ele não tem nenhuma tela, rota ou chamada administrativa.

## O app

Telas:

| Tela | Rota | Conteúdo |
|------|------|----------|
| **Vagas e preços** | `/` (ou `/s/<slug>`) | Nome e endereço do estacionamento, vagas livres agora (total e por categoria) e a tabela de preços, inclusive as tarifas especiais. Atualiza a cada 30 s |
| **Abrir o link do ticket** | `/t#<token>` | O link do QR Code. Guarda o ticket no celular e vai para "Meu ticket" |
| **Meu ticket** | `/ticket` | Placa, nº do ticket, vaga, entrada, **tempo correndo**, **valor até agora**, quando o valor sobe, o cálculo item a item, quanto já foi pago; depois da saída, o valor total e até quando o link funciona |
| **Privacidade** | `/privacidade` | Quais dados aparecem, como o ticket é protegido e o que fica no celular |

- **Valor:** o valor vem sempre da API, calculado pelo mesmo motor do caixa. O app atualiza quando o valor sobe, a cada minuto, ao voltar para o app e quando a internet volta. O relógio de permanência anda a cada segundo, só para exibição.
- **Vários tickets:** até 5 tickets ficam guardados (por exemplo, dois carros). "Esquecer este ticket" apaga um deles do celular.
- **Sem internet:** o app abre normalmente e mostra a última informação recebida, com o horário, e uma faixa "Sem internet".

### Identidade visual

Verde-petróleo `#0d5c55` com menta `#1f9e78`, um ícone de ticket com "P" e picote, placa no estilo Mercosul, números grandes e cartões arredondados. É diferente do painel administrativo, que é azul.

O app tem tema claro e escuro, botões de pelo menos 44 px e navegação inferior que respeita a área segura do iPhone.

- **Ícones:** `public/icones/icone.svg` é a fonte. `npm run icones -w @estacionamento/pwa` gera os PNG: 192 e 512 (comuns), o 512 *maskable* (Android) e o 180 (iPhone).

### Instalação na tela inicial

- **Manifesto** `public/manifest.webmanifest`:
  - nome, nome curto, cores;
  - `display: standalone`;
  - ícones comuns e *maskable*;
  - atalho "Meu ticket".
- **Service worker** `src/sw.ts` (o build gera `sw.js` com a lista de arquivos e a versão):

  | O quê | Como |
  |-------|------|
  | App (HTML, JS, CSS, ícones, manifesto) | Guardado na instalação: abre sem internet |
  | Vagas e preços | Rede primeiro; sem internet, a última cópia |
  | **Ticket** | **Só rede, nunca guardado em cache** (é dado pessoal e vai com o token) |
  | Versão nova | Aparece "Há uma versão nova do app · Atualizar" |

  As regras ficam em `src/sw-regras.ts`, que tem testes.
- **Convite para instalar:**
  - Android e computador mostram o botão "Instalar";
  - no iPhone aparece a instrução "Compartilhar → Adicionar à Tela de Início", porque o Safari não tem esse botão.

## Cada cliente vê só o próprio ticket

1. Na entrada, o servidor local gera um **token aleatório de 32 bytes** e guarda **só o hash** dele. O link é `https://<app>/t#<token>`.
2. O token fica **depois do `#`**, parte que o navegador não envia a servidor nenhum ao abrir a página. O app tira o `#` da barra de endereço logo em seguida, para o token não ir junto num print ou ao copiar o link.
3. O app pede o ticket com o cabeçalho `Authorization: Ticket <token>`. A API calcula o hash e procura **aquele** ticket. A resposta traz só os dados dele, sem identificadores internos.
4. Não existe rota que liste tickets ou busque por placa ou número. Sem o token, não há como ver um ticket.
5. Token inexistente, revogado ("novo link" no caixa) ou expirado (24h após a saída) recebem **a mesma resposta 404**. Há também um limite de 30 consultas por minuto por IP contra quem tenta adivinhar links.

## API pública (`apps/cloud-api`)

| Método | Rota | Resposta |
|--------|------|----------|
| GET | `/v1/sites/:slug/disponibilidade` | Vagas livres e total, por categoria (cache 15 s) |
| GET | `/v1/sites/:slug/tarifas` | Tarifas em vigor em texto legível (cache 5 min) |
| GET | `/v1/ticket` (`Authorization: Ticket <token>`) | O ticket do token (`no-store`) |
| GET | `/saude` | Situação da API |

Segurança:
- **Somente leitura:** qualquer método além de GET é recusado (405), e não há rota administrativa.
- **CORS** liberado só para o endereço do app (`PWA_ORIGENS`), só GET e só o cabeçalho `Authorization`.
- **HTTPS obrigatório em produção:** GET em HTTP é redirecionado, o resto é recusado, e o HSTS fica ligado. O provedor entrega o certificado, e o app usa `CONFIAR_PROXY=1`. Em produção, a API não inicia se `PWA_ORIGENS` tiver endereço sem `https://`.
- **Cabeçalhos e logs:** `Content-Security-Policy: default-src 'none'` e `Referrer-Policy: no-referrer`. Os logs nunca registram o cabeçalho `Authorization`.
- **Valor acumulado:** calculado com `@estacionamento/calculo` (o mesmo do caixa), usando a tarifa gravada no ticket.

## HTTPS

| Ambiente | Como |
|----------|------|
| **Produção** | App numa hospedagem estática com HTTPS automático (Cloudflare Pages ou Netlify). API num provedor com HTTPS (Render, Railway...). O build **recusa** `VITE_API_URL` sem `https://` |
| Neste computador | `localhost` já é tratado como seguro pelos navegadores: o app instala e funciona |
| Testar no celular pela rede | `npm run dev:https -w @estacionamento/pwa` (certificado de teste; o celular pede para confirmar) |

O build também gera `_headers` e `_redirects` para a hospedagem:
- CSP restritiva (só o próprio app e a API pública);
- HSTS;
- `Referrer-Policy: no-referrer`;
- bloqueio de iframe;
- rota única do app.

O mesmo CSP vai numa meta tag do `index.html`.

## Como os dados chegam na nuvem

A **sincronização automática** (servidor local → nuvem, com fila de eventos e assinatura HMAC, ARQUITETURA §6) é um módulo próprio, ainda a implementar. Até lá, a ferramenta de desenvolvimento **`npm run espelhar:local -w @estacionamento/cloud-api`** (`--repetir` = a cada 15 s) copia do banco local para o da nuvem só o que a API mostra:
- estacionamento;
- vagas livres por categoria;
- tarifas em vigor;
- tickets abertos e os que saíram nas últimas 24h, com o hash dos tokens.

Nunca copia usuários, caixa ou pagamentos individuais. A sincronização vai alimentar as mesmas tabelas, sem mudança no app nem na API.

## Experimentar (Windows)

1. Abra o **Demonstracao.cmd**: o painel com dados de exemplo.
2. Abra o **App-Cliente-Demonstracao.cmd**. Ele:
   - prepara o banco da nuvem de demonstração;
   - compila a API e o app;
   - liga a API (porta 8090), o espelho e o app;
   - abre <http://localhost:5174>.
3. No painel, registre uma entrada e abra o link mostrado com o QR Code: o ticket aparece no app.

## Publicar

| Peça | Comandos e configuração |
|------|-------------------------|
| **API** | `npm run build -w @estacionamento/cloud-api` e `npm start -w @estacionamento/cloud-api`. Variáveis: `NODE_ENV=production`, `DB_*` (MySQL do provedor), `PWA_ORIGENS=https://<app>`, `CONFIAR_PROXY=1`. Banco: `npm run db:migrar -w @estacionamento/cloud-api` |
| **App** | `VITE_API_URL=https://<api> VITE_SITE_SLUG=<slug> npm run build -w @estacionamento/pwa`, e publicar a pasta `apps/pwa/dist` |
| **Servidor local** | No `.env`: `PUBLIC_PWA_URL=https://<app>`. Os QR Codes passam a abrir o app publicado |

## Testes

| Onde | O que cobre |
|------|-------------|
| `apps/cloud-api/tests/publico.test.ts` (11) | Valor acumulado e final; resposta sem dados internos; 404 igual para token errado, revogado ou expirado; limite por IP; token na URL ignorado; nenhuma rota administrativa e só leitura; CORS só para o app; cabeçalhos de segurança; redirecionamento para HTTPS |
| `apps/pwa/tests/pwa.test.ts` (9) | Leitura do token do link; tickets guardados (limite, esquecer, sem armazenamento, dados corrompidos); regras do service worker (ticket nunca em cache); formatos |
