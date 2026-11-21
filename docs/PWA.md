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
| **Meu ticket** | `/ticket` | A consulta individual da sessão (ver abaixo) |
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

## Consulta individual da sessão (tela "Meu ticket")

O cliente lê o QR Code ou abre o link recebido na entrada. Não há conta, cadastro nem senha: o link é a chave.

| Item | Como aparece |
|------|--------------|
| **Placa** | Placa no estilo Mercosul, com categoria e vaga |
| **Horário de entrada** | "hoje, 14:05" (ou a data) |
| **Tempo de permanência** | Relógio correndo (estacionado) ou o tempo total (após a saída). Parte do horário do servidor, então não depende do relógio do celular |
| **Valor acumulado** | Calculado pela API com o motor do caixa. Mostra também "Passa a R$ X às HH:MM", quanto já foi pago e o que falta. Após a saída, o valor total |
| **Tabela de tarifas** | A tarifa **gravada neste ticket na entrada** (nome, categoria e linhas de preço). Uma mudança na tabela depois da entrada não altera o ticket. Há um link para todos os preços do estacionamento |
| **Situação atual** | Selo (Estacionado, Encerrado ou Cancelado) e uma frase: dentro da tolerância, pagamento na saída, pago até agora, saída registrada às HH:MM |
| **Última atualização** | "20/11/2026 às 14:32:05 (há 1 min)", o horário do cálculo no servidor. Sem internet ou com dados antigos do estacionamento, o app avisa |

A atualização é automática, pela API externa (veja a seção seguinte).

### Atualização automática e falhas de conexão

As regras ficam em `apps/pwa/src/consulta/regras.ts` (com testes) e o mecanismo em `useConsultaTicket.ts`.

**Quando o app consulta a API**

| Situação | Consulta |
|----------|----------|
| Veículo estacionado | A cada **30 s** e no instante em que o valor sobe (`proximaCobranca`) |
| App volta para a tela / internet volta | Na hora |
| App em segundo plano | Não consulta (economiza bateria e dados) |
| Falha | Novas tentativas automáticas: 5 s, 10 s, 20 s, 40 s e depois a cada 60 s. "Muitas consultas": 60 s |
| Ticket encerrado ou cancelado | Para de consultar (os dados não mudam mais) |
| Link encerrado | Para de consultar |

Uma consulta sem resposta em **10 s** conta como falha, para a tela não ficar "carregando" para sempre. Quando o celular perde a rede, o app marca a falha na hora, sem esperar o tempo limite. Respostas fora de ordem são descartadas, então a tela nunca volta para um dado mais antigo.

**Os dados só aparecem como atuais quando são.** O app classifica o que mostra em três estados:

| Estado | Quando | O que a tela mostra |
|--------|--------|---------------------|
| **Ao vivo** | Última consulta bem-sucedida há menos de 75 s, e o estacionamento enviando dados | "● Atualizando automaticamente · última consulta há 12 s". O relógio corre e o valor aparece como "Valor acumulado até agora" |
| **Estacionamento sem enviar dados** | O servidor local não atualiza a nuvem há mais de 3 min (ex.: estacionamento sem internet) | Aviso com o horário do último envio. O tempo e o valor seguem o relógio, mas uma saída ou um pagamento posterior pode ainda não aparecer |
| **Desatualizado** | Falha na consulta, sem internet, ou última resposta com mais de 75 s | Mensagem de indisponibilidade (sem internet, serviço indisponível ou lento, muitas consultas), mais "Estes dados **não são em tempo real**: são de 20/11/2026 às 16:48:02 (há 7 s)", a próxima tentativa automática e o botão "Tentar agora" |

No estado desatualizado:
- o relógio **para** no horário do último dado ("Tempo de permanência (às 16:48)");
- o valor vira "Valor às 16:48 (último dado recebido)", num quadro sem destaque, com o aviso "pode ter aumentado desde então";
- a situação vira "Situação às 16:48";
- o aviso de quando o valor sobe some.

**Relógio do celular errado:** o tempo corre a partir do horário do servidor. O app mede a diferença entre os dois relógios a cada resposta, então um celular com o relógio adiantado ou atrasado não altera o tempo mostrado.

**Recuperação automática:** quando a internet ou a API volta, a próxima consulta restaura o estado "ao vivo" sem o cliente fazer nada. No teste, isso levou menos de 1 s depois da internet voltar e cerca de 3 s depois de a API voltar.

### Política de encerramento do acesso

Definida no painel, em **Configurações → Link do cliente**. Exige a permissão `config.gerenciar`, e cada alteração fica no histórico de atividades.

| Momento | O que acontece com o link |
|---------|---------------------------|
| Veículo no estacionamento | Sempre funciona |
| Saída registrada | Funciona por mais **N horas**: padrão 24, de 0 ("encerrar na saída") até 168 (7 dias). O prazo é calculado **na saída**; mudar a política depois vale só para as próximas saídas |
| Ticket cancelado ou "novo link" no caixa | O link antigo para na hora |
| Prazo terminou | A API responde "não encontrado". O app apaga placa e valores do celular, mostra "Acesso encerrado" e tira o ticket da lista na próxima abertura. Na nuvem, o registro é **apagado 30 dias após a saída** (rotina de hora em hora); o histórico continua no servidor local |

A tela informa a regra ao cliente: "Depois da saída, este link continua funcionando por 24 horas" e, após a saída, "Este link funciona até 21/11/2026 às 14:32:05".

## Cada cliente vê só o próprio ticket

1. Na entrada, o servidor local gera um **token aleatório de 32 bytes** e guarda **só o hash** dele. O link é `https://<app>/t#<token>`.
2. O token fica **depois do `#`**, parte que o navegador não envia a servidor nenhum ao abrir a página. O app tira o `#` da barra de endereço logo em seguida, para o token não ir junto num print ou ao copiar o link.
3. O app pede o ticket com o cabeçalho `Authorization: Ticket <token>`. A API calcula o hash e procura **aquele** ticket. A resposta traz só os dados dele, sem identificadores internos.
4. Não existe rota que liste tickets ou busque por placa ou número. Sem o token, não há como ver um ticket.
5. **Alterar o código não abre outro ticket.** Os 43 caracteres são aleatórios (2²⁵⁶ combinações) e não têm relação com o número do ticket, a placa ou a vaga. Trocar um caractere gera outro código que não existe. Número, placa ou identificador no lugar do token não são aceitos, e não há rota `/v1/ticket/<número>`. Um link que nunca funcionou nem fica guardado no celular.
6. Token inexistente, revogado ("novo link" no caixa) ou expirado (24h após a saída) recebem **a mesma resposta 404**. Há também um limite de 30 consultas por minuto por IP contra quem tenta adivinhar links.

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

Pela **sincronização automática**: o servidor local grava cada alteração numa fila e a envia para a API externa, com assinatura HMAC, carga completa na primeira conexão e sinal de vida a cada 15 s. Rotas, segurança, dados públicos e o que **nunca** sai do estacionamento estão em [API-EXTERNA.md](API-EXTERNA.md).

## Experimentar (Windows)

1. Abra o **Demonstracao.cmd**: o painel com dados de exemplo.
2. Abra o **App-Cliente-Demonstracao.cmd**. Ele:
   - prepara o banco da nuvem de demonstração;
   - compila a API e o app;
   - liga a API (porta 8090) e o app. O painel já envia os dados sozinho, pela sincronização;
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
| `apps/cloud-api/tests/publico.test.ts` (14) | Tabela de tarifas do próprio ticket e política; código alterado em várias posições, número, placa e identificador no lugar do token: sempre 404; registro apagado da nuvem 30 dias após a saída; valor acumulado e final; resposta sem dados internos; 404 igual para token errado, revogado ou expirado; limite por IP; token na URL ignorado; nenhuma rota administrativa e só leitura; CORS só para o app; cabeçalhos de segurança; redirecionamento para HTTPS |
| `apps/local-server/tests/integracao/sessoes.test.ts` | Política de encerramento: padrão 24h, alteração vale na próxima saída, 0 = encerra na saída, limites, auditoria, permissão |
| `apps/pwa/tests/pwa.test.ts` (17) | Agenda das consultas (30 s, instante da cobrança com o relógio do celular errado, espera crescente nas falhas, parada após encerramento); estados ao vivo, sem sincronia e desatualizado; mensagens de indisponibilidade; remoção de tickets vencidos e dos dados pessoais; data e hora completas; leitura do token do link; tickets guardados (limite, esquecer, sem armazenamento, dados corrompidos); regras do service worker (ticket nunca em cache); formatos |
