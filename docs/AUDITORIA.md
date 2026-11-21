# Auditoria técnica e funcional (novembro/2026)

Auditoria de todo o sistema com **dados de teste reais gravados no MySQL**: o servidor local e a API externa rodando como processos separados, o banco de demonstração persistente e o navegador. O objetivo não era ver as telas abrindo, e sim confirmar que cada operação grava o que deve, recusa o que deve e se recupera de falhas.

## Como foi feito

| Etapa | O quê |
|-------|-------|
| **Testes automatizados** | 255 de integração do servidor local (MySQL real, um banco por arquivo), 38 da API externa, 158 unitários e 100 de integridade do banco (triggers e restrições) |
| **Auditoria de permissões** | Teste novo que percorre **todas** as rotas registradas no Express: sem login → 401; funcionário sem permissões → 403. Rota nova sem proteção quebra o teste (`auditoria-permissoes.test.ts`) |
| **Um dia de operação** | Roteiro com 60 verificações contra o servidor de demonstração: cada passo confere a resposta da API **e** o banco |
| **Telas** | As 14 telas do painel no computador (1280 px) e no celular (390 px): erros no console, falhas HTTP e rolagem horizontal. App do cliente aberto pelo link real de um ticket |

### O roteiro do dia (60 verificações)

1. **Autenticação:** senha errada, login, nenhum hash na resposta, 401 sem sessão.
2. **Cadastro de funcionário:** criação com acesso, lista sem CPF, login e CPF duplicados, senha provisória que bloqueia tudo até a troca, senha fraca recusada.
3. **Vagas:** bloqueio gravado no banco e liberação.
4. **Caixa e entrada:** abertura (e recusa de um segundo caixa), placa normalizada, placa repetida, placa maliciosa (`ABC';--`) recusada sem detalhes internos, ticket persistido, link do cliente.
5. **App do cliente:** o ticket chega à nuvem, sem operador, caixa ou forma de pagamento; token alterado → 404.
6. **Saída:**
   - valor da tela diferente do servidor é recusado;
   - pagamento dividido (dinheiro com troco + Pix);
   - **dois cliques simultâneos** não duplicam o pagamento;
   - ticket encerrado no banco, e o banco recusa alterá-lo.
7. **Internet/nuvem fora do ar:** entrada e cancelamento continuam; o painel mostra a fila e a falha; quando a nuvem volta, a fila é enviada sozinha; o ticket feito sem internet aparece no app, o cancelado deixa de abrir e o pago aparece encerrado.
8. **Financeiro:** estorno de ticket encerrado recusado (regra documentada); pagamento antecipado e estorno; operador não estorna; o estorno não se repete; o fechamento com diferença exige observação e registra a falta.
9. **Relatórios:** faturamento líquido igual à soma dos pagamentos válidos no banco; estorno no relatório; entradas dos indicadores iguais ao banco.
10. **Banco travado e de volta:** resposta 503 clara, **nada gravado depois**, e o servidor volta sozinho.
11. **Reinício do servidor:** a sessão e os tickets abertos continuam.
12. **Encerramento:** logout encerra a sessão no servidor; o histórico registra as ações; os erros são registrados sem placas.

## Problemas encontrados e corrigidos

| # | Gravidade | Problema | Correção |
|---|-----------|----------|----------|
| 1 | **Alta** | **Entradas simultâneas recebiam "estacionamento lotado" com vagas livres.** A busca da vaga livre (`... LIMIT 1 FOR UPDATE SKIP LOCKED`) travava todas as linhas percorridas, e não só a escolhida. Num pico com vários guichês, entradas eram recusadas | Os candidatos são lidos sem trava e cada vaga é travada individualmente. Teste de regressão `sessoes-concorrencia-livres.test.ts` (corrigido junto com o módulo de backup) |
| 2 | **Alta** | **Banco travado (não desligado) deixava as telas esperando para sempre.** Com o MySQL parado por disco cheio, bloqueio ou sobrecarga, a tela do caixa congelava sem mensagem. O próprio Monitoramento também congelava | Limite de tempo na transação (`DB_TRANSACAO_LIMITE_MS`, 12 s): a conexão é descartada e o MySQL desfaz a operação. Limite de resposta da API (`REQUISICAO_LIMITE_MS`, 15 s) com 503 "O servidor não conseguiu responder a tempo". O backup fica fora desse limite |
| 3 | **Alta** | **Operação gravada depois de a tela mostrar erro.** Uma entrada presa antes da transação (na conferência do login) recebia 503 e, quando o banco voltava, era gravada mesmo assim. O operador veria erro e o ticket existiria | A requisição que já respondeu 503 fica marcada como expirada (`contexto-requisicao.ts`). Nenhuma transação dela começa ou faz COMMIT depois disso. Teste `banco-travado.test.ts` |
| 4 | **Média** | **App do cliente bloqueado quando muitos clientes dividem o mesmo IP.** O limite de 30 consultas/min **por IP** valia para todas as consultas. O app consulta a cada 30 s: com uns 15 clientes atrás do mesmo IP (NAT da operadora de celular, wi-fi do estacionamento ou `CONFIAR_PROXY` esquecido no provedor), todos recebiam "Muitas consultas" | Por IP, só contam as consultas que **falham**, para barrar quem tenta adivinhar links. Por ticket, o limite é de 12/min. Teto alto de 1200/min por IP. A API avisa no log se roda em produção com `CONFIAR_PROXY=0`. Testes novos em `publico.test.ts` |
| 5 | Baixa | CPF, e-mail ou documento duplicado mostrava "Já existe um registro com esses dados" | Mensagens próprias: "Já existe um funcionário cadastrado com este CPF.", "Este e-mail já está em uso…" |
| 6 | Baixa | Relatórios administrativos → Vagas bloqueadas: no celular, a tabela passava da tela (506 px numa tela de 390 px) | As tabelas da aba ficam na área com rolagem própria, como as outras |
| 7 | Baixa | Monitoramento: "Verificar agora" usava o cache de 15 s, e a API externa recém-caída aparecia como no ar | O botão refaz as verificações (`?forcar=1`). As mensagens de internet e da API externa local ficaram coerentes entre si |

## Conferido e sem problema

- **Permissões:** todas as rotas exigem login e permissão. As únicas abertas a qualquer funcionário logado são o próprio caixa, o painel e as listas de apoio.
- **Pagamentos:** a chave de idempotência e as travas impedem pagamento em dobro, inclusive com requisições simultâneas. A soma dos pagamentos é igual ao valor final, e o banco impede alterar ticket encerrado e movimentação financeira.
- **Sincronização:** a operação continua sem internet, a fila é enviada ao voltar, e cancelamentos e encerramentos chegam ao app.
- **Recuperação:**
  - banco caído ou travado: 503, sem gravação pela metade, o servidor volta sozinho;
  - reinício do servidor: a sessão e os tickets continuam;
  - restauração de backup: testada em `backup.test.ts`.
- **Segurança:**
  - SQL Injection: recusado na validação, e todas as consultas são parametrizadas;
  - XSS: o único HTML injetado é o QR Code gerado pelo servidor;
  - o token do cliente sai da barra de endereço;
  - os erros são registrados sem dados pessoais;
  - a lista de funcionários não traz CPF.
- **Telas:** 14 telas no computador e no celular, sem erros no console, sem falhas HTTP e sem rolagem horizontal. O app do cliente abre o ticket real.

## Pontos de atenção (não são defeitos)

- **Estorno depois da saída:** é recusado de propósito, porque a conta está fechada ([FINANCEIRO.md](FINANCEIRO.md)). Para devolver dinheiro a um cliente depois da saída, use uma sangria com o motivo, ou proponha uma regra de "devolução" para uma próxima versão.
- **Ambiguidade no limite de tempo:** se o banco travar exatamente durante o COMMIT, a operação pode ter sido gravada. Nesse caso, repetir é seguro:
  - pagamentos têm chave de idempotência;
  - a entrada repetida mostra "veículo já estacionado".
