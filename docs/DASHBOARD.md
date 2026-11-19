# Painel (Dashboard) — como cada número é calculado

Todos os valores vêm do **banco local**, em tempo real, pela rota `GET /api/v1/dashboard`. Não há nenhum valor fixo no código. O painel busca os dados de novo **a cada 15 segundos**. A busca pausa com a aba escondida e é refeita assim que ela volta. Se uma atualização falhar, os últimos dados continuam na tela com um aviso.

"Hoje" é o dia corrente no fuso do estacionamento (`FUSO_OFFSET`, padrão `-03:00`).

## Indicadores

| Indicador | Cálculo |
|-----------|---------|
| **Total de vagas** | Vagas `ATIVA` + `MANUTENCAO`. As `INATIVA` (capacidade reduzida) não contam |
| **Vagas disponíveis** | Vagas `ATIVA` sem sessão aberta |
| **Vagas ocupadas** | Vagas com sessão aberta. O % é sobre as vagas utilizáveis (total − manutenção) |
| **Vagas bloqueadas** | Vagas em `MANUTENCAO` |
| **Veículos estacionados** | Sessões `ABERTA`, inclusive as sem vaga definida. Se passar das ocupadas, aparece um alerta |
| **Faturamento hoje** | Soma dos pagamentos `CONFIRMADO` registrados hoje. Estornados não entram. O valor de ontem aparece como referência |
| **Pagamentos pendentes** | Sessões abertas cujo **valor acumulado até agora** (calculado pela mesma função de tarifa do caixa, `packages/shared/src/tarifa.ts`) é maior que o já pago. O valor é uma **estimativa**: continua crescendo até a saída |

## Gráficos

- **Ocupação nas últimas 24 h:** quantos veículos estavam estacionados em cada hora cheia, mais o momento atual. Sessões canceladas não contam. A linha cinza é a capacidade **atual**: mudanças de capacidade ao longo do dia não são redesenhadas.
- **Faturamento dos últimos 7 dias:** pagamentos confirmados por dia. O detalhamento por forma de pagamento aparece ao passar o mouse e em *Ver tabela*.

Os dois gráficos funcionam pelo teclado (setas no gráfico de ocupação, Tab nas colunas) e têm a visão em tabela.

## Alertas operacionais

| Alerta | Quando aparece | Nível |
|--------|----------------|-------|
| Nenhuma vaga cadastrada / nenhuma tarifa publicada | Configuração incompleta: impede registrar entradas | Crítico |
| Categoria lotada | Nenhuma vaga livre na categoria | Crítico |
| Quase lotado / ocupação alta | ≥ 95% / ≥ 80% das vagas utilizáveis | Importante / Atenção |
| Veículo há mais de 24 h | Sessão aberta há mais de 24 h (saída pode ter sido esquecida) | Atenção |
| Caixa aberto há mais de 12 h | Fechamento possivelmente esquecido | Atenção |
| Contas bloqueadas | Usuários bloqueados por tentativas (só para quem gerencia usuários) | Atenção |
| Sincronização atrasada / com erros | Dados aguardando envio há mais de 15 min / recusados pela nuvem | Atenção / Importante |
| Vagas em manutenção, estornos do dia, veículos sem vaga | Informativo | Informação |

Os limites ficam em `LIMITES`, em `apps/local-server/src/modules/dashboard/dashboard.service.ts`.

## Quem vê o quê

| Seção | Permissão necessária (basta uma) |
|-------|----------------------------------|
| Vagas, veículos, ocupação, movimentos | `sessao.consultar`, `vaga.gerenciar`, `relatorio.operacional` |
| Faturamento, pendentes, caixas | `relatorio.financeiro`, `caixa.supervisionar` |
| Sincronização | `sync.ver` |

## Sincronização

O envio para a nuvem ainda não foi implementado. Por isso o painel mostra **"Ainda não configurada"** até `CLOUD_API_URL` e `SITE_ID` estarem definidos. Os números de "aguardando envio" e "recusados" já vêm da tabela `sync_outbox`.

## Banco de demonstração

Enquanto as telas de entrada, saída e caixa não existem, o banco real fica sem movimento: o painel mostra zeros e os alertas de configuração, o que é o comportamento correto. Para ver o painel funcionando:

- **Windows:** dois cliques em `Demonstracao.cmd`. Ele usa um banco **separado**, `estacionamento_demo`, gerado de novo a cada vez, e abre em http://localhost:8081 (login `demo`, senha `Painel2026`).
- **Terminal:**
  ```bash
  npm run demo:criar
  ```

Os dados passam por todas as regras do banco:
- cada carro só ocupa uma vaga livre;
- os pagamentos são feitos em caixas abertos;
- os valores saem da tabela de tarifas;
- há cancelamentos e estornos.
