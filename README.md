# Estacionamento

Sistema de gerenciamento de estacionamento:

- **servidor local** com painel administrativo, que funciona sem internet;
- **API na nuvem**, que deixa os dados disponíveis para consulta;
- **PWA**, para o cliente acompanhar o próprio ticket pelo celular.

| Documento | Conteúdo |
|-----------|----------|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Arquitetura, sincronização, segurança, tarifas, retenção |
| [`docs/BANCO_LOCAL.md`](docs/BANCO_LOCAL.md) | Modelo do banco MySQL local e diagramas ER |

## Estrutura

```
Estacionamento/
├── apps/
│   ├── local-server/        BACKEND local: Node.js + Express + MySQL (API REST)
│   │   ├── src/
│   │   │   ├── config/          variáveis de ambiente (validadas), logger, versão
│   │   │   ├── db/              pool MySQL, transação com auditoria, health, runner de SQL
│   │   │   ├── http/            erros padronizados, tradução de erros do MySQL, middlewares, rotas
│   │   │   ├── modules/         um módulo por domínio (routes → service → repository)
│   │   │   ├── integrations/    FUTURAS INTEGRAÇÕES: LPR, sensores, cancela, impressora
│   │   │   ├── sync/            (a implementar) worker de sincronização com a nuvem
│   │   │   ├── app.ts           monta o Express
│   │   │   └── server.ts        inicialização e encerramento gracioso
│   │   ├── scripts/db-criar.ts  cria o banco a partir de database/local
│   │   ├── tests/               unit/ (sem banco) e integracao/ (MySQL real, banco isolado)
│   │   └── .env.example
│   ├── admin-web/           FRONTEND: painel administrativo (React + Vite)
│   ├── cloud-api/           (a implementar) API externa
│   └── pwa/                 (a implementar) app do cliente
├── packages/
│   └── shared/              contratos e utilitários usados por backend e frontend
├── database/
│   ├── local/               BANCO DE DADOS: scripts SQL 001–004 + testes
│   └── cloud/               (a modelar) banco da nuvem
├── infra/                   (a implementar) instalador Windows, Docker da nuvem
└── docs/
```

### Como adicionar um módulo novo à API

1. Crie `apps/local-server/src/modules/<nome>/` com três arquivos:
   - `<nome>.routes.ts`: HTTP e validação com Zod;
   - `<nome>.service.ts`: regras de negócio;
   - `<nome>.repository.ts`: SQL.
2. Registre o módulo em `apps/local-server/src/modules/index.ts`.
3. Para gravar dados, use `comTransacao(contexto, fn)`. Ela preenche as variáveis de auditoria lidas pelos triggers.
4. Para sinalizar erros, use `throw erros.naoEncontrado(...)` (ou outro de `http/erros.ts`). O tratador central converte qualquer erro para o formato padrão:

```json
{ "erro": { "codigo": "NAO_ENCONTRADO", "mensagem": "…", "detalhes": [], "requestId": "…" } }
```

O módulo `formas-pagamento` serve de exemplo completo.

## Pré-requisitos (Windows)

- **Node.js 22 LTS**: https://nodejs.org (instalador `.msi`, opções padrão)
- **MySQL 8.4 LTS**, com o banco `estacionamento` criado (ver `docs/BANCO_LOCAL.md` §9)
- **Git**

## Primeira execução

No PowerShell, dentro da pasta do projeto:

1. Instale as dependências (uma vez, ou quando o `package.json` mudar):

```bash
npm install
```

2. Crie o arquivo de configuração a partir do modelo:

```bash
copy apps\local-server\.env.example apps\local-server\.env
```

3. Abra `apps\local-server\.env` no Bloco de Notas ou no VS Code e preencha `DB_PASSWORD` com a senha do root do MySQL.

4. **Só se o banco ainda não existir:** crie o banco e aplique os scripts. Se já existir, o comando recusa sem alterar nada.

```bash
npm run db:criar -w @estacionamento/local-server
```

5. Inicie em modo desenvolvimento:

```bash
npm run dev
```

O comando sobe duas coisas:
- a **API** em http://localhost:8080 (reinicia sozinha ao salvar um arquivo);
- o **painel** em **http://localhost:5173** (atualiza na hora).

Abra o painel no navegador. Ele mostra se o servidor e o banco estão funcionando.

## Modo produção (como vai rodar no estacionamento)

```bash
npm run build
```

```bash
npm start
```

O painel compilado passa a ser servido pelo próprio servidor em **http://localhost:8080**. Outros computadores da rede acessam por `http://<ip-deste-pc>:8080`. Para isso, libere a porta 8080 no Firewall do Windows, só para a rede local.

## Comandos

| Comando | O que faz |
|---------|-----------|
| `npm run dev` | API + painel em modo desenvolvimento |
| `npm run build` | Compila shared, servidor e painel |
| `npm start` | Inicia o servidor compilado |
| `npm test` | Testes unitários (não precisam de banco) |
| `npm run test:integracao` | Testes com MySQL real. Cria e **apaga** o banco `estacionamento_teste`; o banco real não é tocado |
| `npm run typecheck` | Verificação de tipos TypeScript |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run db:criar -w @estacionamento/local-server` | Cria o banco local a partir de `database/local` |

## Endpoints disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Status da API e do banco (503 se o banco estiver fora) |
| GET | `/api/v1/health/live` | Processo no ar (não consulta o banco) |
| GET | `/api/v1/formas-pagamento?ativas=true` | Lista formas de pagamento |
| GET | `/api/v1/formas-pagamento/:codigo` | Uma forma de pagamento |
