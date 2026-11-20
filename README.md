# Estacionamento

Sistema de gerenciamento de estacionamento:

- **servidor local** com painel administrativo, que funciona sem internet;
- **API na nuvem**, que deixa os dados disponíveis para consulta;
- **PWA**, para o cliente acompanhar o próprio ticket pelo celular.

| Documento | Conteúdo |
|-----------|----------|
| [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) | Arquitetura, sincronização, segurança, tarifas, retenção |
| [`docs/BANCO_LOCAL.md`](docs/BANCO_LOCAL.md) | Modelo do banco MySQL local e diagramas ER |
| [`docs/RELATORIOS.md`](docs/RELATORIOS.md) | Faturamento diário/semanal/mensal/por período, formas de pagamento, histórico com detalhe, pendentes e fechamentos de caixa |
| [`docs/FINANCEIRO.md`](docs/FINANCEIRO.md) | Pagamentos, estorno, proteção contra duplicidade, caixa (abertura, sangria, fechamento) e resumo diário |
| [`docs/CALCULO.md`](docs/CALCULO.md) | Cálculo automático das estadias (só no backend): valor acumulado, próxima cobrança, saída e testes |
| [`docs/TARIFAS.md`](docs/TARIFAS.md) | Versões de tarifa, arredondamento, tarifas especiais, simulador e rastreabilidade das cobranças |
| [`docs/OPERACAO.md`](docs/OPERACAO.md) | Entrada e saída: ticket, QR do cliente, cálculo, pagamento, caixa e validações |
| [`docs/VEICULOS.md`](docs/VEICULOS.md) | Cadastro por placa, histórico de estadias e regra de uma estadia aberta |
| [`docs/VAGAS.md`](docs/VAGAS.md) | Mapa de vagas, bloqueio, exclusão com histórico e capacidade |
| [`docs/DASHBOARD.md`](docs/DASHBOARD.md) | Como cada indicador, gráfico e alerta do painel é calculado |
| [`docs/AUTENTICACAO.md`](docs/AUTENTICACAO.md) | Login, sessões, bloqueio de tentativas, níveis de acesso, gerenciamento de usuários e histórico |

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
│   │   ├── scripts/             db-migrar.ts (banco) e criar-admin.ts (primeiro acesso)
│   │   ├── tests/               unit/ (sem banco) e integracao/ (MySQL real, banco isolado)
│   │   └── .env.example
│   ├── admin-web/           FRONTEND: painel administrativo (React + Vite)
│   ├── cloud-api/           (a implementar) API externa
│   └── pwa/                 (a implementar) app do cliente
├── packages/
│   ├── shared/              contratos (tipos) e utilitários usados por backend e frontend
│   └── calculo/             motor de cálculo das estadias — SÓ backends (o painel recebe os valores da API)
├── database/
│   ├── local/               BANCO DE DADOS: migrations SQL 001–010 + testes
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

## Uso no dia a dia (Windows) — sem digitar comandos

Na pasta do projeto há três arquivos para abrir com **dois cliques**:

| Arquivo | Quando usar | O que faz |
|---------|-------------|-----------|
| **`Atualizar.cmd`** | Sempre que houver uma versão nova | Baixa a versão do GitHub, instala dependências, atualiza o banco (`db:migrar`) e compila o painel |
| **`Iniciar.cmd`** | Para usar o sistema | Liga o servidor numa janela minimizada e abre o painel em http://localhost:8080. Se o servidor já estiver ligado, só abre o painel |
| `Criar-Administrador.cmd` | Primeiro acesso | Cria o estacionamento e um usuário administrador |
| `Demonstracao.cmd` | Para ver o painel com movimento | Abre um banco **separado** com 7 dias de dados de exemplo em http://localhost:8081 (login `demo` / `Painel2026`). O banco real não é alterado |

**Para desligar o servidor**, feche a janela *Servidor do Estacionamento* na barra de tarefas. **Antes de atualizar**, desligue o servidor: o `Atualizar.cmd` avisa se ele estiver ligado.

**Atalho na área de trabalho:** clique com o botão direito em `Iniciar.cmd` → *Mostrar mais opções* → *Enviar para* → *Área de trabalho (criar atalho)*.

Os comandos abaixo continuam disponíveis para desenvolvimento.

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

4. Crie ou atualize o banco. Pode rodar sempre: o comando aplica só as migrations que faltam e reconhece um banco criado à mão.

```bash
npm run db:migrar
```

5. Crie o primeiro administrador. O comando pergunta o nome do estacionamento, o seu nome, o login e a senha:

```bash
npm run usuario:admin
```

6. Inicie em modo desenvolvimento:

```bash
npm run dev
```

O comando sobe duas coisas:
- a **API** em http://localhost:8080 (reinicia sozinha ao salvar um arquivo);
- o **painel** em **http://localhost:5173** (atualiza na hora).

Abra o painel no navegador e entre com o login criado no passo 5.

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
| `npm run db:migrar` | Cria o banco (se preciso) e aplica as migrations pendentes de `database/local` |
| `npm run usuario:admin` | Cria o estacionamento (na 1ª vez) e um usuário administrador |
| `npm run demo:criar` | Recria o banco separado de demonstração (`estacionamento_demo`) |

## Endpoints disponíveis

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/health` | Status da API e do banco (503 se o banco estiver fora) |
| GET | `/api/v1/health/live` | Processo no ar (não consulta o banco) |
| POST | `/api/v1/auth/login` | Entrar (público) |
| POST | `/api/v1/auth/logout` | Sair |
| GET | `/api/v1/auth/sessao` | Usuário logado, perfis e permissões |
| POST | `/api/v1/auth/trocar-senha` | Trocar a própria senha |
| GET | `/api/v1/formas-pagamento?ativas=true` | Lista formas de pagamento (requer login) |
| GET | `/api/v1/formas-pagamento/:codigo` | Uma forma de pagamento (requer login) |
| GET/POST/PATCH/PUT | `/api/v1/usuarios...` | Funcionários, acesso, níveis e permissões |
| GET | `/api/v1/permissoes` | Catálogo de permissões e modelos |
| GET | `/api/v1/atividades` | Histórico de atividades |
| GET/POST/PATCH/PUT | `/api/v1/vagas...` · `/api/v1/categorias` | Vagas, capacidade e categorias (ver docs/VAGAS.md) |
| GET/POST/PATCH | `/api/v1/veiculos...` | Veículos, consulta por placa e estadias (ver docs/VEICULOS.md) |
| GET/POST/PATCH/PUT/DELETE | `/api/v1/tarifas...` | Versões de tarifa: rascunho, regras, publicação e arquivamento (ver docs/TARIFAS.md) |
| GET/POST | `/api/v1/sessoes...` · `/api/v1/caixa...` | Entrada, prévia e registro da saída, cancelamento, novo link e caixa do operador (ver docs/OPERACAO.md e docs/CALCULO.md) |
| GET/POST | `/api/v1/financeiro...` | Resumo do dia, pagamentos, pendentes, movimentações, caixas e estorno (ver docs/FINANCEIRO.md) |
| GET | `/api/v1/relatorios...` | Relatórios financeiros e detalhe de movimentações (ver docs/RELATORIOS.md) |
| GET | `/api/v1/dashboard` | Indicadores, gráficos, alertas e sincronização do painel |

Todas as rotas, exceto `/health` e `/auth/login`, exigem login. Detalhes em [`docs/AUTENTICACAO.md`](docs/AUTENTICACAO.md).
