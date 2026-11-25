# Interface do painel

Tema escuro (azul-marinho e grafite), com o azul nos botões e itens selecionados e uma cor para cada situação de vaga: **verde** livre, **vermelho** ocupada, **laranja** bloqueada e **cinza** indisponível (desativada).

## Menu

Oito módulos. Funções relacionadas ficam em abas dentro da mesma página, para o menu não crescer.

| Módulo | O que tem |
|--------|-----------|
| **Painel** | Indicadores do dia, movimentação por horário, faturamento de 7 dias, situação do caixa, últimas entradas e saídas, alertas |
| **Operação** ▸ | **Vagas** (abre depois do login) · Entrada e saída · Movimentações |
| **Financeiro** ▸ | Caixa (meu caixa, resumo, pendentes, pagamentos, movimentações, caixas anteriores) · Indicadores financeiros |
| **Cadastros** ▸ | Veículos · Funcionários |
| **Relatórios** | Relatórios administrativos (movimento, ocupação, permanência, veículos, horários, funcionários) |
| **Auditoria** | Histórico de atividades, somente consulta |
| **Sistema** ▸ | Monitoramento · Backups |
| **Configurações** ▸ | Gerais (estacionamento, operação, usuários e permissões, segurança, integrações, notificações) · Tarifas · Privacidade e LGPD |

Módulo com um item só (Relatórios, Auditoria) é um link direto. Relatórios e listas têm os botões **Excel** (arquivo .xlsx) e **PDF** (impressão do navegador, sem o menu e os botões).

Os grupos abrem e fecham; o grupo da página atual fica aberto. Cada funcionário só vê o que tem permissão para usar. No celular, o menu fica atrás do botão **Menu**.

No topo de todas as páginas: data, hora e o usuário (com **Trocar senha** e **Sair**). No rodapé do menu: se o servidor está respondendo e a versão do sistema.

## Vagas

- **Indicadores:** total, livres, ocupadas e bloqueadas, com a proporção de cada uma.
- **Mapa:** uma vaga por bloco, com filtro por setor, busca por vaga ou placa e legenda das cores. Atualiza sozinho a cada 10 segundos.
- **Detalhes da vaga** (ao clicar): veículo, horário de entrada e tempo estacionado (ou o motivo do bloqueio), e três ações:
  - **Dar saída:** pede a confirmação e abre a tela de saída com o ticket já carregado, para conferir o valor e receber. A saída só é gravada lá;
  - **Alterar status:** livre, bloqueada (com motivo) ou indisponível, sempre com confirmação. Uma vaga ocupada não muda de status;
  - **Atualizar:** recarrega os dados.
- **Cadastro:** Categorias, Capacidade, Nova vaga e "Editar dados da vaga", para quem tem permissão.

## Tarifas

Veja [TARIFAS.md](TARIFAS.md#cadastrar-editar-e-desativar-sempre-numa-nova-versão).
