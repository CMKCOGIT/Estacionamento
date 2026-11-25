# Módulos do sistema (expansão de novembro/2026)

Este documento resume a expansão feita sobre o sistema existente: o que já existia e foi mantido, o que foi criado, as mudanças no banco, os testes e as decisões tomadas onde o pedido era ambíguo. Nada foi refeito do zero: tecnologias, arquitetura e identidade visual são as mesmas.

## Organização (8 módulos)

| Módulo | Telas | Situação |
|--------|-------|----------|
| Painel | Indicadores, gráficos, situação do caixa, alertas | Ampliado |
| Operação | Vagas · Entrada e saída · **Movimentações** | Movimentações é nova |
| Financeiro | Caixa (com **Caixas anteriores** e correção) · Indicadores financeiros | Ampliado |
| Cadastros | Veículos · Funcionários | Funcionários ganhou 3 níveis |
| Relatórios | Relatórios administrativos | Exportação Excel/PDF |
| Auditoria | Histórico de atividades (somente consulta) | Filtro por horário, acesso negado, exportação |
| Sistema | Monitoramento · Backups | Fila de sincronização; download, agenda e restauração de backup |
| Configurações | Gerais (7 abas) · Tarifas · Privacidade e LGPD | Gerais refeita; LGPD ganhou incidentes e inventário |

## O que foi criado

### Níveis de acesso (Administrador, Gerente, Operador)
Ver [AUTENTICACAO.md §6](AUTENTICACAO.md). O nível limita as permissões **no servidor**, em toda requisição. Gerente e Operador têm limite de desconto definido pelo Administrador. Há permissões padrão por nível, que o Administrador edita.

### Configurações por categoria
Tabela `configuracoes` (já existia), uma chave por categoria, com histórico automático (triggers):

| Aba | Conteúdo | Quem altera |
|-----|----------|-------------|
| Estacionamento | Nome, endereço, telefone, horário, logotipo (PNG/JPEG/WebP até 200 KB) | `config.gerenciar` |
| Operação | Resumo de vagas e tipos aceitos (geridos em Vagas), vaga automática, QR Code após a entrada, confirmação de saída, alerta de permanência longa | `config.gerenciar` |
| Tarifas | Atalho para a tela de Tarifas | — |
| Usuários e permissões | Níveis, limite de desconto, permissões padrão | Administrador |
| Segurança e acessos | Sessão, senha, bloqueio, acesso só pela rede local, sessões abertas | Administrador |
| Comunicação e integrações | Servidor externo (somente leitura), link do cliente, sincronização | `config.gerenciar` |
| Notificações | Quais categorias de alerta aparecem no Painel | `config.gerenciar` |

O que é lido a cada requisição (segurança, limites) fica 30 s em memória; salvar limpa na hora.

### Painel
Novos: entradas e saídas do dia, **recebido no caixa hoje**, gráfico de **movimentação por horário**, **situação do caixa** (abertos, troco inicial, dinheiro em caixa) e alertas de backup, falhas do sistema, segurança (senhas erradas, acessos negados) e permanência longa. Os três valores financeiros são separados:
- **Faturamento** = pagamentos − estornos (por data do pagamento);
- **Recebido no caixa** = pagamentos registrados no guichê hoje (todas as formas);
- **Dinheiro em caixa** = o que deve estar agora nas gavetas abertas.

### Operação → Movimentações
Placa, tipo, entrada, saída, vaga, funcionário e situação, com filtros (placa/ticket, tipo, situação, datas), paginação e exportação. O **Operador vê só as que ele registrou**; quem supervisiona vê todas (`GET /api/v1/sessoes/historico`).

### Caixa: caixas anteriores e correção
O fechamento nunca muda. Uma correção (dinheiro achado, erro de contagem) é uma **nova movimentação `AJUSTE`** no caixa fechado, com motivo e quem autorizou (`caixa.supervisionar`). A tela mostra a diferença original e a **diferença corrigida**. O banco só aceita `AJUSTE` em caixa **fechado** e com motivo (trigger `trg_mov_bi`); qualquer outra movimentação em caixa fechado continua recusada.

### Indicadores financeiros
Novo: **receita por tipo de veículo** (carro × moto) no período. Os demais já existiam: faturamento total, diário e mensal (agrupar por mês = comparativo mensal), por forma de pagamento, quantidade de pagamentos, descontos, diferenças de fechamento.

### Exportação
Todos os relatórios e listas principais têm **Excel** (.xlsx real, gerado no navegador, sem biblioteca externa: números ficam como número) e **PDF** (impressão do navegador, sem menu e botões).

### Auditoria
Novos registros: `acesso.negado` (tentativa sem permissão), `auth.login_recusado_rede`, `auth.sessao_encerrada`, `caixa.ajuste`, `perfil.padrao_alterado`, `backup.baixado`, `backup.restaurado`, `backup.restauracao_recusada`, `lgpd.incidente_*`, `sync.reenviar`. Filtro por faixa de horário. A tabela continua protegida no banco (triggers recusam UPDATE e DELETE).

### Monitoramento
Nova seção **Registros não sincronizados** (pendentes e recusados, com tentativas e erro) e o botão **Reenviar agora**, que tira a espera dos pendentes e devolve os recusados à fila. O reenvio é idempotente (cada evento tem ID único; a nuvem ignora repetidos).

### Backups
**Baixar** (arquivo cifrado), **Restaurar** pelo painel (senha + "RESTAURAR", backup de segurança antes, modo manutenção, migrations aplicadas depois) e **agenda** (ligar/desligar e horário). Ver [BACKUP.md](BACKUP.md).

### Privacidade e LGPD
Novas abas: **Incidentes de segurança** (art. 48: registrar, acompanhar medidas e comunicações à ANPD e aos titulares, encerrar; não pode ser apagado nem alterado depois de encerrado) e **Dados armazenados e política** (inventário com quantidades reais do banco, finalidade, quem acessa, retenção, link da política publicada no app do cliente).

## Banco de dados (migration `016_niveis_configuracoes.sql`)

| Mudança | Detalhe |
|---------|---------|
| Permissão `config.seguranca` | Só Administrador |
| Perfil de nível `gerente` | E `funcionario` renomeado para Operador (código mantido) |
| Migração de usuários | Funcionário com permissão de supervisão → Gerente (ninguém perde acesso) |
| Modelos `padrao_gerente` e `padrao_operador` | Permissões padrão de cada nível |
| Triggers de `movimentacoes_financeiras` | `AJUSTE` só em caixa fechado e com motivo |
| `vw_caixa_resumo` | Não soma `AJUSTE` (o fechamento fica como foi) |
| Triggers de `configuracoes` | Logotipo entra no histórico como tamanho + SHA-256, não a imagem |
| Tabela `lgpd_incidentes` | Com triggers: não apaga, encerrado não muda, histórico automático |
| `backups.tipo` | Aceita `PRE_RESTAURACAO` |
| Tabela `backup_restauracoes` | Quando, quem, de qual arquivo e o backup de segurança |

Nenhum dado existente é apagado. A migration roda sozinha no **Atualizar.cmd**.

## Testes

| Conjunto | Resultado |
|----------|-----------|
| Integração do servidor local (MySQL real) | **277 testes** passando, incluindo `expansao.test.ts` (20 novos) e `backup.test.ts` (9, com backup, download e restauração pelo painel). Observação: 3 testes antigos de `relatorios-operacionais.test.ts` falham se rodados entre 0h e ~2h (criam entradas "horas atrás" que caem no dia anterior); é do teste, não do sistema |
| Unitários | 39 do servidor local e 2 do painel |
| Telas | 21 telas e abas no computador e no celular: sem erros, sem falhas HTTP, sem rolagem horizontal |
| Fluxo no navegador | Configuração salva e refletida no menu; Gerente cadastrado com permissões padrão; planilha Excel aberta e conferida |

Os testes obrigatórios do pedido e onde estão:

| Teste | Onde |
|-------|------|
| Entrada; placa duplicada; vaga ocupada; saída libera a vaga | `sessoes.test.ts`, `sessoes-concorrencia*.test.ts` |
| Cálculo das tarifas | `calculo.test.ts`, `tarifas.test.ts`, `packages/calculo` |
| Pagamentos; abertura e fechamento; diferenças | `financeiro.test.ts`, `expansao.test.ts` (correção de caixa) |
| Permissões | `auditoria-permissoes.test.ts` (todas as rotas), `usuarios.test.ts`, `expansao.test.ts` (níveis e limites) |
| Auditoria | `expansao.test.ts` (acesso negado, imutabilidade), `auth.test.ts` |
| Sem internet e sincronização depois | `sync.test.ts` |
| Backup e restauração | `backup.test.ts` |

## Decisões e limitações

- **Vagas continua sendo a tela inicial**, como pedido antes, agora dentro de Operação (primeiro item). O Painel é o primeiro item do menu.
- **Tarifas e LGPD** ficam em Configurações, como no pedido. Não há telas duplicadas: o mesmo endereço (`/tarifas`, `/privacidade`) aparece só ali.
- **"Quantidade e identificação das vagas" e "tipos de veículos aceitos"** já eram geridos na tela de Vagas, com regras (vaga ocupada não pode ser bloqueada, bloqueio exige motivo). A aba Operação mostra o resumo e leva para lá, sem duplicar.
- **Endereço do servidor externo e credencial** continuam no `.env` (definidos pelo Conectar-Nuvem.cmd): guardar a chave no banco a deixaria visível em backups e na tela. O painel mostra os valores e a situação.
- **App do cliente:** o intervalo de atualização do ticket continua fixo (30 s). A preferência configurável é o prazo do link após a saída.
- **Notificações** são os alertas do Painel. Envio por e-mail/WhatsApp exigiria um provedor externo (ver [EXPANSAO.md](EXPANSAO.md) §2.7).
- **PDF** é gerado pela impressão do navegador ("Salvar como PDF"), que funciona em qualquer computador sem instalar nada.
- **Estorno depois da saída** continua recusado (conta fechada). Para devolver dinheiro, use sangria com motivo ou uma correção de caixa.
- **Gerente "dentro dos limites"**: o limite é de desconto na saída. Cancelamento e estorno são permissões que o Administrador concede ou não ao Gerente.
