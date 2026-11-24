# Interface do painel

Tema escuro (azul-marinho e grafite), com o azul nos botões e itens selecionados e uma cor para cada situação de vaga: **verde** livre, **vermelho** ocupada, **laranja** bloqueada e **cinza** indisponível (desativada).

## Menu

| Item | O que tem |
|------|-----------|
| **Vagas** | Tela principal, a primeira depois do login |
| **Painel** | Indicadores gerais: ocupação, faturamento do dia, pendências, gráficos e alertas |
| **Operação** ▸ | Entrada e saída · Veículos |
| **Financeiro** ▸ | Caixa · Tarifas |
| **Relatórios** ▸ | Administrativos · Financeiros |
| **Administração** ▸ | Funcionários · Atividades · Monitoramento · Backups · Privacidade (LGPD) · Configurações |

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
