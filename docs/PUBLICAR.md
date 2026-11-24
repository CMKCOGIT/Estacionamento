# Publicar o app do cliente (passo a passo)

Para o cliente acompanhar o ticket pelo celular, três peças ficam na internet. As três têm **plano grátis** e não exigem cartão de crédito na hora de escrever este guia; confira os planos ao contratar, porque eles mudam.

| Peça | Para que serve | Onde |
|------|----------------|------|
| Banco de dados da nuvem | Guarda a cópia pública dos tickets | **TiDB Cloud** (compatível com MySQL) |
| API externa | Recebe os dados do seu computador e entrega para o celular | **Render** |
| App do cliente | A tela que o cliente abre pelo QR Code | **Cloudflare Pages** |

Leva uns 30 minutos. Use o mesmo login do GitHub nos três sites (botão "Continuar com GitHub"). Vá anotando num bloco de notas o que for pedido.

## Passo 1 — Banco de dados (TiDB Cloud)

1. Entre em **tidbcloud.com** → **Sign Up** (com Google, GitHub ou e-mail).
2. Clique em **Create Cluster** → escolha o plano **Starter** (grátis) → região **AWS N. Virginia (us-east-1)** → **Create**.
3. Quando o cluster estiver pronto, clique em **Connect** (canto superior direito).
4. Clique em **Generate Password** e anote:
   - **Host**: algo como `gateway01.us-east-1.prod.aws.tidbcloud.com`;
   - **Port**: `4000`;
   - **User**: algo como `2abcDEF.root`;
   - **Password**: a senha gerada. Ela aparece **uma vez só**.

O sistema foi testado no TiDB: os 40 testes da API externa passam nele.

## Passo 2 — API externa (Render)

1. Entre em **render.com** → **Get Started** → **GitHub**.
2. Clique em **New +** → **Blueprint**.
3. Escolha o repositório **Estacionamento** e clique em **Connect**. O Render lê o arquivo `render.yaml` do projeto e já sabe o que fazer.
4. Ele pede alguns valores. Preencha com o que anotou no Passo 1:

   | Campo | O que colocar |
   |-------|---------------|
   | `DB_HOST` | o Host do TiDB |
   | `DB_PORT` | `4000` |
   | `DB_USER` | o User do TiDB (com o ponto, ex.: `2abcDEF.root`) |
   | `DB_PASSWORD` | a senha do TiDB |
   | `PWA_ORIGENS` | deixe em branco por enquanto (preenche no Passo 4) |

5. Clique em **Apply**. A primeira vez leva uns 5 minutos.
6. Quando aparecer **Live** (verde), anote o endereço que aparece no topo, como `https://estacionamento-api.onrender.com`.
   - Para conferir: abra esse endereço com `/saude` no final. Deve aparecer `{"status":"ok"}`.
7. Clique em **Environment** e copie o valor de **`SYNC_CHAVE_MESTRA`** (clique no olho). **Guarde em segredo:** é a senha da sua nuvem.

## Passo 3 — App do cliente (Cloudflare Pages)

1. Entre em **dash.cloudflare.com** → crie a conta → no menu, **Workers & Pages** → **Create** → aba **Pages** → **Connect to Git** → escolha o repositório **Estacionamento**.
2. Em **Project name**, escreva um nome, por exemplo `meu-estacionamento`. O endereço do app será `https://meu-estacionamento.pages.dev`. Anote.
3. Preencha:

   | Campo | O que colocar |
   |-------|---------------|
   | Framework preset | `None` |
   | Build command | `npm ci && npm run build:pacotes && npm run build -w @estacionamento/pwa` |
   | Build output directory | `apps/pwa/dist` |

4. Abra **Environment variables** e adicione:

   | Nome | Valor |
   |------|-------|
   | `VITE_API_URL` | o endereço do Render (Passo 2.6) |
   | `NODE_VERSION` | `22.12.0` |

5. Clique em **Save and Deploy** e espere terminar (uns 3 minutos).

## Passo 4 — Avisar a API qual é o app

1. Volte ao **Render** → **estacionamento-api** → **Environment**.
2. Em **`PWA_ORIGENS`**, coloque o endereço do app (Passo 3.2), por exemplo `https://meu-estacionamento.pages.dev`.
3. Clique em **Save Changes**. O Render reinicia sozinho.

## Passo 5 — Ligar o seu computador à nuvem

1. No seu computador, rode o **Atualizar.cmd**.
2. Dê dois cliques em **`Conectar-Nuvem.cmd`** e responda às 3 perguntas:
   1. o endereço do Render;
   2. o endereço do app;
   3. a `SYNC_CHAVE_MESTRA`.
3. Feche a janela "Servidor do Estacionamento" e abra o **Iniciar.cmd**.
4. No painel, abra **Configurações**. Em **Sincronização com a nuvem** deve aparecer **"Em dia"** em até 1 minuto.

Para testar, faça uma entrada e leia o QR Code com o celular: o ticket abre no app.

## Se algo der errado

| O que aparece | O que fazer |
|---------------|-------------|
| No Render, **Failed** ou erro com `DB_` | Confira o Host, a Port (`4000`), o User inteiro (com o ponto) e a senha, sem espaços nas pontas |
| `/saude` mostra erro ou demora | No plano grátis, a API "dorme" depois de 15 minutos sem uso e leva até 1 minuto para acordar. Espere e recarregue |
| Conectar-Nuvem diz "A API não respondeu" | Abra o endereço `/saude` no navegador antes, para acordar a API, e rode de novo |
| Configurações continua "Desligada" | Você não reiniciou o servidor: feche a janela "Servidor do Estacionamento" e abra o Iniciar.cmd |
| "Credencial recusada" | A chave mestra foi copiada errada. Rode o Conectar-Nuvem.cmd de novo com o valor certo |
| O app abre, mas diz que não encontrou o ticket | Espere 1 minuto (sincronização) e confira se o `PWA_ORIGENS` do Passo 4 está certo |

Detalhes técnicos: [API-EXTERNA.md](API-EXTERNA.md) e [PWA.md](PWA.md).
