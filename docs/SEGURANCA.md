# Segurança do sistema

Mapa das medidas de segurança, onde cada uma está no código e como verificar. Proteção de dados pessoais e LGPD: [LGPD.md](LGPD.md).

## Visão geral

| Medida | Servidor local (painel) | API externa (nuvem) | App do cliente |
|--------|------------------------|---------------------|----------------|
| Autenticação | Login e senha de funcionário, sessão no servidor | Integrações: HMAC por estacionamento | Sem login: token do ticket |
| Permissões | Perfis + permissões por funcionário | Escopos por integração | Só o próprio ticket, só leitura |
| HTTPS | Opcional na rede local (`Ativar-HTTPS.cmd`) | Obrigatório em produção | Obrigatório (o build recusa HTTP) |
| Validação | Zod em toda entrada + regras no banco | Zod em toda entrada | — |
| SQL Injection | Consultas parametrizadas | Consultas parametrizadas | — |
| Registro | Histórico de atividades (triggers + aplicação) | `registro_api` | — |
| Erros | Formato único, sem detalhes internos em produção | Idem | Mensagens amigáveis |

## 1. Autenticação de funcionários

Detalhes e decisões: [AUTENTICACAO.md](AUTENTICACAO.md).

- **Sessão:**
  - token aleatório de 32 bytes num cookie `httpOnly`, `SameSite=Strict` e `Secure` com HTTPS;
  - só o SHA-256 do token fica no banco;
  - a sessão expira por inatividade (60 min) e por duração máxima (12 h).
- **Bloqueio:** 5 senhas erradas bloqueiam a conta por 15 minutos. Há também um limite de tentativas por IP.
- **Login inexistente:** a resposta tem o mesmo tempo de um login existente (um hash fictício é verificado), para não revelar quais logins existem.
- **Troca de senha:** obrigatória no primeiro acesso e depois de uma redefinição pelo administrador. Trocar a senha encerra as outras sessões do usuário.
- **Proteção contra CSRF:** `SameSite=Strict` e conferência da origem (`verificarOrigem`) em todas as rotas `/api`.

## 2. Controle de permissões

- **Perfis:** administrador, operador e financeiro, mais permissões marcadas por funcionário.
- **Por rota:** cada rota exige a sua com `exigirPermissao(...)`.
- **Painel:** esconde o que o funcionário não pode usar, mas a decisão é sempre do servidor.
- **Operações sensíveis:**

  | Operação | Permissão |
  |----------|-----------|
  | Estorno, cancelamento, desconto | Específica, com motivo obrigatório |
  | Tarifas | `tarifa.gerenciar` / `tarifa.publicar` |
  | Configurações | `config.gerenciar` |
  | Atendimento LGPD | `lgpd.atender`, só administradores por padrão |
  | Histórico | `auditoria.ver` |

- **Testes:** cada módulo tem testes que verificam o 403 para quem não tem a permissão.

## 3. Proteção de senhas

- **Armazenamento:** **argon2id** (parâmetros da OWASP: 19 MiB, t=2, p=1). A senha nunca é guardada nem registrada.
- **Política:** de 8 a 128 caracteres, combinando letras e números, e sem conter o login (`POLITICA_SENHA` e `problemasDaSenha` em `packages/shared`). A mesma validação roda na tela e no servidor.
- **Logs:** campos `senha`, `senhaAtual`, `novaSenha`, `password`, `token` e `segredo` são ocultados em qualquer log.

## 4. Tokens individuais

| Token | Como é feito | O que fica guardado |
|-------|--------------|---------------------|
| Sessão do painel | 32 bytes aleatórios | SHA-256 |
| Ticket do cliente (link/QR) | 32 bytes aleatórios (base64url, 43 caracteres), depois do `#` no link | SHA-256, no local e na nuvem. Revogável ("novo link") e com prazo (política de encerramento) |
| Integração (servidor local → nuvem) | Segredo derivado da chave mestra (HMAC), com assinatura por requisição, janela de 5 min e nonce de uso único | Nada: o segredo não fica no banco |

Para o ticket, um código errado, alterado ou expirado recebe a mesma resposta 404. A consulta tem limite por IP. Detalhes: [API-EXTERNA.md](API-EXTERNA.md) e [PWA.md](PWA.md).

## 5. HTTPS

| Onde | Como |
|------|------|
| **Painel na rede local** | `Ativar-HTTPS.cmd` (ou `npm run https:certificado -w @estacionamento/local-server`) gera um certificado para o nome e os IPs deste computador e liga `HTTPS_CERT_FILE`/`HTTPS_KEY_FILE` no `.env`. Com isso: TLS 1.2+, cookie `Secure`, HSTS e, opcionalmente, `HTTP_REDIRECIONAR_PORTA` levando `http://` para `https://`. Em produção sem HTTPS, o servidor avisa no log ao iniciar |
| **API externa** | Em produção, o HTTPS é obrigatório: GET em HTTP é redirecionado, o resto é recusado, e o HSTS fica ligado |
| **App do cliente** | O build recusa uma API sem `https://`. A hospedagem entrega HTTPS e HSTS |
| **Servidor local → nuvem** | Em produção, o servidor local recusa iniciar com `CLOUD_API_URL` sem `https://` |

**Certificado da rede local:** ele é autoassinado. Para os navegadores do caixa não mostrarem aviso, instale `apps/local-server/certificados/servidor.crt` em cada computador:
- **Windows:** clique duas vezes no arquivo → Instalar certificado → Máquina local → "Autoridades de Certificação Raiz Confiáveis".
- A chave `servidor.key` **nunca** sai do servidor e está no `.gitignore`.

## 6. Validação de dados

- **Entrada:** todo corpo, parâmetro e query é validado com **Zod** antes de chegar ao serviço. Tem tipos, tamanhos, formatos (placa, CPF, ULID, horários) e limites numéricos (centavos inteiros).
- **Corpo:** até 100 KB no servidor local; até 512 KB/2 MB na sincronização.
- **Regras de negócio:** ficam no servidor (por exemplo, o cálculo e a soma dos pagamentos) e também no banco, com `CHECK`s e triggers (ticket encerrado é imutável, histórico só de inserção, movimentações financeiras não se alteram).
- **Nuvem:** valida cada campo recebido do servidor local e descarta campos a mais.

## 7. Proteção contra SQL Injection

- **Consultas parametrizadas:** 100% delas (`mysql2`, com `?`). Nomes de tabela e coluna nunca vêm do usuário.
- **Nomes de banco:** nos scripts, são validados com `/^[A-Za-z0-9_]+$/`.
- **Usuário do MySQL:** use em produção um usuário de aplicação com privilégios mínimos, sem `root` (ARQUITETURA §7.1). O MySQL fica escutando só em `127.0.0.1`.
- **Teste:** `privacidade.test.ts` envia `ABC';--` e recebe 400, sem detalhes do banco na resposta.

## 8. Controle de acesso às sessões dos clientes

- **Um token, um ticket:** cada link só abre o próprio ticket. Não existe rota que liste tickets ou busque por placa ou número.
- **Prazo:** o link funciona até N horas depois da saída (Configurações → Link do cliente). "Novo link" revoga o anterior, e o cancelamento revoga na hora.
- **Encerramento:** quando o acesso termina, o app apaga a placa do celular. A nuvem apaga o ticket 30 dias depois da saída.
- **No painel:** a consulta de tickets exige login e a permissão `sessao.consultar`.

## 9. Registro de atividades importantes

| Registro | O quê |
|----------|-------|
| `historico_atividades` (local) | Gravado por **triggers** (não há como esquecer, nem por SQL manual) e pela aplicação. Inclui: login, falha de login, bloqueio, logout; entrada, saída, cancelamento, estorno, desconto; caixa; tarifas; permissões; configurações; LGPD (consulta, exportação, anonimização, solicitações); sincronização. Só de inserção: nem a aplicação altera; só a rotina de retenção expurga ou redige |
| `registro_api` (nuvem) | Lotes recebidos, recusas de autenticação, limites excedidos, erros |
| `sync_execucoes` | Cada sincronização |
| Correlação | Cada requisição tem um `X-Request-Id`, que liga o log, o histórico e o registro da nuvem |

## 10. Tratamento de erros

- **Formato único:** `{ erro: { codigo, mensagem, detalhes?, requestId } }`.
- **Em produção:** erros internos dizem só "Erro interno no servidor". Nada de pilha, SQL ou nome de tabela na resposta.
- **Erros do MySQL:** são traduzidos em mensagens de negócio (`erros-mysql.ts`): duplicidade, chave estrangeira, regras dos triggers.
- **Rota inexistente:** a resposta não repete a query string, que poderia trazer dados pessoais.
- **Banco fora do ar:** resposta 503 com uma mensagem clara. O servidor continua de pé e reconecta sozinho.

## 11. Proteção de informações pessoais

Veja [LGPD.md](LGPD.md). No código:
- **Logs:**
  - campos de dados pessoais (`placa`, `cpf`, `documento`, `email`, `telefone`) viram `[oculto]`;
  - placas, CPF/CNPJ, e-mails e telefones dentro de mensagens viram `[placa]`, `[cpf]`...;
  - a URL vai sem a query string;
  - erros do MySQL perdem o SQL com os valores.

  Fica em `apps/local-server/src/config/logger.ts` e `apps/cloud-api/src/config/logger.ts`, com teste em `privacidade.test.ts`.
- **Respostas da API:**
  - a lista de funcionários não traz CPF, telefone nem e-mail (só a ficha individual, para quem gerencia usuários);
  - o relatório do titular mostra o CPF de clientes mascarado (`123.***.***-01`);
  - a API pública não traz identificadores internos, operadores, formas de pagamento nem caixa.
- **Nuvem:** só a projeção pública sai do estacionamento ([API-EXTERNA.md](API-EXTERNA.md#dados-públicos-o-que-pode-e-o-que-não-pode-sair-do-estacionamento)).

## Checklist de implantação

1. **Banco:** MySQL só em `127.0.0.1`, com usuário de aplicação próprio e senha forte. Backup diário criptografado com segunda cópia fora do PC ([BACKUP.md](BACKUP.md)), e a chave guardada fora do computador.
2. **HTTPS:** `Ativar-HTTPS.cmd` e o certificado instalado nos computadores do caixa.
3. **Firewall:** no Windows, a porta do painel liberada só para a rede do estacionamento. Nenhuma porta aberta no roteador.
4. **Contas:** uma por funcionário, sem compartilhar. Senha do administrador guardada à parte.
5. **Nuvem:** `NODE_ENV=production`, `SYNC_CHAVE_MESTRA` secreta, `PWA_ORIGENS` com `https://`.
6. **LGPD:** cadastre o encarregado (Privacidade → Retenção e encarregado) e revise a política de retenção.
