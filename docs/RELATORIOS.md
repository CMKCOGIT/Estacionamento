# Relatórios financeiros

Menu **Relatórios** do painel (`/relatorios`).

- **Backend:** `apps/local-server/src/modules/relatorios`.
- **Tela:** `apps/admin-web/src/pages/Relatorios.tsx` e `components/relatorios`.
- **Gráficos:** `components/graficos/GraficoColunas.tsx` e `GraficoBarras.tsx`.

Os relatórios usam **os dados reais do banco**. Os totais são calculados pelo servidor, e a tela só exibe. Os dias, semanas e meses seguem o fuso do estacionamento (`FUSO_OFFSET`). Um pagamento às 23:30 de sábado conta no sábado, mesmo sendo 02:30 de domingo em UTC.

## O que é "faturamento"

| Valor | Definição |
|-------|-----------|
| **Recebido** | Pagamentos registrados no período, inclusive os estornados depois |
| **Estornos** | Estornos feitos no período (pela data do estorno) |
| **Faturamento (líquido)** | Recebido − estornos. É o valor dos gráficos |
| Tickets encerrados | Tickets com saída no período. "Sem cobrança" = saíram dentro da tolerância |
| Ticket médio | Valor final médio dos tickets encerrados com cobrança |
| Média por dia | Líquido ÷ dias do período |

Estes números são os mesmos do **Resumo do dia** do menu Caixa (os testes conferem).

## Relatórios

### Faturamento: diário, semanal, mensal e período personalizado

1. Escolha o agrupamento:
   - **Diário**: um ponto por dia;
   - **Semanal**: de segunda a domingo;
   - **Mensal**.
2. Escolha o período: um atalho (hoje, últimos 7/30 dias, este mês, mês passado, últimas 12 semanas, últimos 12 meses, este ano) ou as datas **De** e **Até**, para qualquer período.

O relatório mostra:
- indicadores (faturamento, recebido, estornos, média por dia, tickets) e a **variação em relação ao período anterior** de mesmo tamanho (▲/▼ e %);
- **gráfico de colunas** do líquido. Passe o mouse (ou use o Tab) sobre uma coluna para ver o detalhe: pagamentos, tickets, estornos e o valor **por forma de pagamento**;
- **tabela** de cada dia, semana ou mês, com a linha de total;
- **Exportar planilha** (CSV que abre no Excel).

Dias, semanas e meses sem movimento aparecem com zero: o gráfico não esconde lacunas. A primeira e a última semana (ou mês) são cortadas nas datas escolhidas.

Limites de período: diário até 400 dias, semanal até 3 anos, mensal até 5 anos. Acima disso, o sistema pede outro agrupamento.

### Formas de pagamento

Para cada forma no período:
- **barras** do faturamento líquido, com valor e participação (%);
- tabela com quantidade, recebido, estornado, líquido, %, média por pagamento, troco (dinheiro) e média de parcelas (crédito);
- **Exportar planilha**.

### Histórico de pagamentos

- **Pagamentos:** filtre por período, forma, situação (concluídos/estornados) e placa ou nº do ticket.
- **Todas as movimentações do caixa:** abertura, recebimentos, estornos, sangrias e suprimentos, filtrados por período, tipo e forma.

**Detalhes**, em cada linha, abre tudo sobre a movimentação ou o pagamento:
- a movimentação (tipo, entrada ou saída do caixa, forma, valor, quem registrou, descrição);
- o pagamento: situação, recebido/troco, autorização, parcelas e o estorno (quando, quem e o motivo);
- o **ticket**: placa, entrada, saída, permanência, tarifa aplicada (com a versão da tabela), o cálculo item a item e o valor final;
- o **caixa** (guichê, operador, abertura e fechamento);
- as **movimentações relacionadas** (por exemplo, o recebimento e o estorno do mesmo pagamento). Cada uma pode ser aberta;
- o **histórico de atividades** (quem fez o quê e quando).

O mesmo detalhe também abre em Caixa → Movimentações.

### Pagamentos pendentes

Tickets no estacionamento com valor a receber **agora** (valor acumulado − já pago), atualizado a cada 30 s:
- total a receber e quantos já pagaram uma parte;
- **barras por tempo de permanência** (até 1h, 1–3h, 3–6h, 6–24h, mais de 24h);
- a lista de tickets.

### Fechamentos de caixa

Caixas **fechados** no período (pela data do fechamento):
- indicadores: fechamentos, quantos conferiram, quantos tiveram falta e sobra (e os totais), diferença líquida e o recebido nesses caixas;
- tabela com data, guichê/operador (e quem fechou, se foi outro), duração, recebido, dinheiro esperado, contado e a conferência (✓ Conferiu / ▲ Sobra / ▼ Falta), com a observação;
- **Detalhes** abre o caixa com o total por forma e todas as movimentações;
- **Exportar planilha**.

## Gráficos

- Uma série por gráfico, numa cor só, a mesma do painel, validada para contraste e daltonismo nos temas claro e escuro. Grade discreta.
- O valor aparece escrito no maior ponto (colunas) ou no fim de cada barra.
- Detalhe ao passar o mouse ou focar pelo teclado.
- A tabela com os mesmos números fica logo abaixo de cada gráfico.
- Situações como falta e sobra usam ícone e texto, nunca só cor.

## Permissões

Relatórios financeiros: `relatorio.financeiro` ou `caixa.supervisionar`. O modelo "Financeiro" tem as duas. O "Operador de caixa" não vê os relatórios, só o próprio caixa.

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/v1/relatorios/faturamento?de&ate&agrupar=DIA\|SEMANA\|MES` | Pontos (com valor por forma), totais, período anterior e variação |
| GET | `/api/v1/relatorios/formas?de&ate` | Totais por forma de pagamento |
| GET | `/api/v1/relatorios/pendentes` | Pendentes agora, por faixa de permanência |
| GET | `/api/v1/relatorios/fechamentos?de&ate` | Caixas fechados e totais de conferência |
| GET | `/api/v1/relatorios/detalhe?movimentacaoId=…` ou `?pagamentoId=…` | Detalhe de uma movimentação ou de um pagamento |
| GET | `/api/v1/financeiro/pagamentos` · `/financeiro/movimentacoes` | Histórico com filtros e paginação (ver [FINANCEIRO.md](FINANCEIRO.md)) |

## Relatórios administrativos (operação)

Painel → **Relatórios administrativos** (permissão `relatorio.operacional`). Os dados são reais do banco local e calculados no servidor (`apps/local-server/src/modules/relatorios-operacionais`). As datas seguem o fuso do estacionamento.

| Aba | Conteúdo | Filtros |
|-----|----------|---------|
| **Indicadores** | Entradas, saídas, entradas/dia, rotatividade (saídas por vaga/dia), veículos no pátio, vagas bloqueadas, permanência média e mediana, % na tolerância, ocupação média e de pico, hora mais cheia, ticket médio, receita por vaga/dia, cancelamentos (%). Gráfico de entradas por categoria | Período (até 92 dias) |
| **Entradas e saídas** | Totais e gráfico de entradas por dia. Lista de tickets com entrada ou saída no período (até 2.000), com placa, vaga, horários, permanência, valor e quem registrou. Exporta planilha | Período, placa (início), funcionário (entrada, saída ou cancelamento), situação |
| **Veículos estacionados** | Quem está no pátio agora, com o tempo e o **valor acumulado pelo mesmo cálculo do caixa** | Placa, funcionário da entrada |
| **Histórico por placa** | Cadastro do veículo, visitas, total pago, permanência média e todas as estadias. Exporta planilha | Placa |
| **Ocupação** | Pico de vagas ocupadas por dia (com o horário) e média; **média por hora do dia** (para escalar a equipe); por categoria | Período (até 92 dias) |
| **Vagas bloqueadas** | As bloqueadas agora (motivo, desde quando, quantos dias, quem bloqueou; 7 dias ou mais em destaque) e os bloqueios e liberações do período, tirados do histórico | Período, funcionário |
| **Por funcionário** | Entradas, saídas, cancelamentos, pagamentos, valor recebido (confirmado), estornos, descontos concedidos e caixas abertos. Gráfico e planilha | Período, funcionário |
| **Histórico de atividades** | As 200 atividades mais recentes do período, com quem fez e o motivo. O detalhe completo fica em Atividades (exige `auditoria.ver`) | Período, funcionário |

Como os números são calculados:
- **Ocupação:** cada ticket ocupa a vaga da entrada até a saída; os cancelados não contam. A **média** soma as horas-veículo de cada hora e divide pela hora. O **pico** percorre entradas e saídas em ordem. A capacidade considera as vagas **ativas** (as bloqueadas não entram).
- **Permanência:** conta só os tickets que **saíram** no período.
- **Cancelamentos:** % sobre as entradas do período.
- **Funcionário:**
  - entrada = quem registrou a entrada;
  - saída = quem registrou a saída;
  - cancelamento = quem cancelou;
  - pagamento = quem recebeu;
  - estorno = quem estornou.

Testes: `apps/local-server/tests/integracao/relatorios-operacionais.test.ts`, com um cenário controlado:
- totais e filtros por placa, situação e funcionário;
- valor acumulado igual ao do caixa;
- histórico por placa;
- pico de ocupação;
- bloqueio aparecendo nas vagas bloqueadas e no histórico;
- contagens por funcionário;
- indicadores (inclusive a mediana);
- validação dos filtros e da permissão.
