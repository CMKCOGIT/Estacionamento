# Monitoramento técnico

Painel → **Monitoramento** (permissão `sistema.monitorar`, só administradores por padrão). A tela se atualiza sozinha a cada 15 segundos e mostra, em uma olhada, se algo pode afetar a operação do estacionamento.

## O que aparece

| Indicador | O que é verificado | Quando fica amarelo (Atenção) | Quando fica vermelho (Falha) |
|-----------|--------------------|-------------------------------|------------------------------|
| **Servidor local** | Versão, tempo no ar, memória, carga do processador, disco livre, HTTPS | Menos de 10 GB livres no disco ou menos de 5% de memória livre | Menos de 2 GB livres no disco |
| **Banco de dados** | `SELECT 1` com tempo de resposta, versão do MySQL, tamanho, conexões abertas | Resposta acima de 500 ms | Sem resposta em 3 s |
| **Internet** | Resolução de nome (DNS) do endereço da nuvem | Sem internet, mas a nuvem não está configurada (ou é local) | Sem internet com a nuvem configurada |
| **API externa** | `GET /saude` da `CLOUD_API_URL` com tempo de resposta | Resposta acima de 2 s | Sem resposta, ou a API responde que está com problema |
| **Sincronização** | Registros pendentes, detecções pendentes, recusados, última sincronização, último contato, última conferência, falhas seguidas | Falha recente ou pendente há mais de 2 min | Alteração recusada pela nuvem, ou falhas há mais de 10 min |
| **Backup** | Último backup, última falha, próximo, segunda cópia | Mais de 26 h sem backup, ou sem segunda cópia | Último backup falhou, arquivo com problema ou mais de 48 h sem backup |

Cinza (**Desligado**) significa que o recurso não está configurado (por exemplo, sem nuvem).

Acima dos cartões:
- um **estado geral** (o pior de todos);
- a **lista de alertas**, com a causa e o que fazer.

Abaixo:
- números: registros pendentes, última sincronização, falhas de comunicação e erros internos nas últimas 24 h;
- **falhas de comunicação com a nuvem** (as últimas 15 da tabela `sync_execucoes`);
- **erros recentes** (os últimos 15 da tabela `erros_sistema`).

## Erros recentes

Todo erro interno (resposta HTTP 500) e toda promessa rejeitada sem tratamento ficam registrados em `erros_sistema`, com:
- horário, código, rota (sem a query string) e o `X-Request-Id`, que liga ao log;
- mensagem **sem dados pessoais** (placas, CPF, e-mail e telefone são mascarados).

Os erros saem depois de 30 dias. Se o banco estiver fora do ar, o erro vai só para o log (registrar um erro nunca causa outro).

## Se algo ficar vermelho

| Situação | O que fazer |
|----------|-------------|
| Banco indisponível | `services.msc` → serviço **MySQL84** → Iniciar. Entradas e saídas param enquanto o banco estiver fora |
| Sem internet | Verifique o cabo/Wi-Fi e o roteador. O estacionamento continua funcionando; os dados ficam na fila e vão quando a internet voltar |
| API externa inacessível, com internet | O problema está no provedor da nuvem (Render, Railway...). Os dados ficam na fila |
| Sincronização com recusados | Configurações → Sincronização → **Ressincronizar** |
| Backup com falha | Painel → Backups: o motivo está na lista ([BACKUP.md](BACKUP.md)) |
| Disco quase cheio | Libere espaço ou mova `BACKUP_DIR` para outro disco |
| Servidor local sem resposta | A própria tela avisa. Abra de novo o **Iniciar.cmd** |

## Detalhes técnicos

- Rota: `GET /api/v1/monitoramento` (`apps/local-server/src/monitoramento/monitoramento.service.ts`).
- As verificações de rede (internet e API externa) ficam em cache por 15 s: várias abas abertas não multiplicam as consultas.
- Se o banco cair, a rota continua respondendo (os componentes que dependem dele aparecem como falha).
- Testes: `apps/local-server/tests/integracao/monitoramento.test.ts`.
