# Cálculo automático das estadias

O valor de uma estadia é calculado **só no backend**, num pacote próprio: `packages/calculo` (`@estacionamento/calculo`). O painel e, no futuro, o app do cliente apenas **mostram** o que a API devolve.

| Onde | O que faz |
|------|-----------|
| `packages/calculo/src/motor.ts` | Regra de tarifa + minutos → valor, item a item. Inclui tolerância, 1ª hora, hora adicional, fração, carência, diária máxima, diária, preço fixo e quando uma tarifa especial vale |
| `packages/calculo/src/estadia.ts` | `calcularEstadia`: entrada + agora/saída + tarifa do ticket → permanência, valor acumulado, desconto/acréscimo, já pago, saldo e **próxima cobrança** |
| `packages/calculo/src/pagamentos.ts` | `conferirPagamentos`: completa a linha automática, calcula o troco, confere a soma e aponta cada problema |
| `packages/shared` | Só os **tipos** dos contratos da API e textos de exibição. Não calcula valores |

A regra de lint **impede** o painel (`apps/admin-web`) de importar `@estacionamento/calculo`. Quem tentar recebe a mensagem: "O cálculo das estadias é feito no servidor".

## O que entra no cálculo

| Dado | De onde vem |
|------|-------------|
| Horário de entrada | `sessoes_estacionamento.entrada_em`, gravado com o relógio do **banco** |
| Horário atual ou de saída | `NOW(3)` do banco, na mesma consulta do cálculo. A saída grava exatamente esse instante |
| Tempo de permanência | Minutos, **arredondados para cima**: 1 h e 1 s = 61 min. Saída antes da entrada (relógio fora de ordem) conta 0 |
| Tarifa | A **cópia gravada no ticket na entrada** (`tarifa_aplicada`), nunca a tabela atual. Ver [TARIFAS.md](TARIFAS.md) |
| Frações, tolerância e arredondamento | Campos da tarifa: fração de hora (limitada ao valor da hora adicional), tolerância (só no início) e carência por período |
| Diárias | No **modo diária**, cada 24h iniciadas custam uma diária. No **modo por tempo**, a **diária máxima** limita cada período de 24h |
| Desconto e acréscimo | Na saída, com permissão e motivo. O desconto não pode passar do valor da estadia |
| Já pago | Soma dos pagamentos confirmados do ticket |

## Durante a permanência: valor acumulado

Todas as telas recebem o mesmo cálculo, feito pelo servidor no momento da consulta:

| Tela | Rota | O que mostra |
|------|------|--------------|
| Entrada e saída: lista "No estacionamento agora" | `GET /sessoes/abertas` | Valor até agora e **"R$ X a partir de HH:MM"** (atualiza a cada 15 s) |
| Entrada e saída: painel de saída | `POST /sessoes/:id/previa-saida` | Valor, itens do cálculo, desconto, pagamentos conferidos, troco, quanto falta ou sobra e os problemas |
| Veículo | `GET /veiculos/:id` | Valor em aberto da estadia atual |
| Painel (Dashboard) | `GET /dashboard` | Total pendente dos tickets abertos |

A **próxima cobrança** diz em que instante o valor sobe e para quanto. A tela de saída recalcula sozinha nesse instante: o operador nunca confirma um valor desatualizado sem ver. O valor nunca diminui com o tempo (provado pelos testes), então esse instante é achado por busca binária.

## Na saída: valor final

A prévia e o encerramento usam **as mesmas funções**:

1. `calcularEstadia` com a regra do ticket e o relógio do banco.
2. Se o valor mudou desde a conferência (por exemplo, virou uma fração), a saída é recusada. A tela mostra o novo valor.
3. `conferirPagamentos`: a soma precisa bater com o valor a pagar. Só dinheiro tem troco, e o valor recebido não pode ser menor que o pago. Um pagamento pode ser "automático", completando o restante: a tela manda o valor vazio e **o servidor** decide quanto é.
4. Os pagamentos, o encerramento e `calculo_detalhe` (permanência, itens, ajustes, valor final) são gravados na mesma transação. Depois disso, o ticket encerrado não é recalculado: vale o que foi gravado.

## Exemplos (Carro: 1ª hora R$ 10 · hora adicional R$ 6 · fração 15 min R$ 2 · diária máxima R$ 40 · diária R$ 35 · tolerância 10 min)

| Permanência | Valor | Por quê |
|-------------|-------|---------|
| 10 min | R$ 0,00 | Dentro da tolerância |
| 10 min e 1 s | R$ 10,00 | Passou da tolerância: 1ª hora |
| 1 h e 1 s | R$ 12,00 | O minuto iniciado conta: 1 fração |
| 1h46 | R$ 16,00 | 4 frações (R$ 8) limitadas à hora adicional (R$ 6) |
| 2h20 | R$ 20,00 | 10 + 6 + 2 frações |
| 7 h | R$ 40,00 | Teto da diária máxima |
| 24h01 | R$ 50,00 | 1 diária máxima + 1ª hora do dia seguinte |
| 25h20 | R$ 54,00 | 40 + (10 + 2 frações) |
| 3 dias e 5 min | R$ 130,00 | A tolerância só vale no começo da estadia |
| 26 h no modo diária | R$ 70,00 | 2 diárias |

## Testes

- **`packages/calculo/tests`** (91 testes):
  - **situações com horários reais**: segundos, limite da tolerância, viradas de hora e de fração, teto, vários dias, meia-noite, diária, preço fixo, carência, relógio fora de ordem;
  - **propriedades** verificadas em 61 tarifas (60 geradas de forma aleatória, mas reproduzível, e a de exemplo):
    - o valor nunca diminui com o tempo (verificado minuto a minuto por 4 dias);
    - nenhum período de 24h passa da diária máxima;
    - os itens sempre somam o total;
    - o valor acumulado no instante da saída é igual ao valor final;
    - só a duração importa (o dia e o horário da entrada não mudam o valor);
    - a próxima cobrança coincide com a busca minuto a minuto;
  - **conferência dos pagamentos**: linha automática, divisão, troco, soma errada, forma inválida, parcelas.
- **`apps/local-server/tests/integracao/calculo.test.ts`** (pela API, com MySQL):
  - 13 situações de permanência;
  - a próxima cobrança;
  - o **mesmo valor no mesmo instante** no ticket, na lista, no veículo, no painel e na prévia;
  - a saída cobra exatamente o valor da prévia, inclusive o pagamento automático e o troco;
  - tolerância sem pagamento, modo diária, desconto;
  - ticket encerrado não é recalculado;
  - o simulador do servidor.
- `apps/local-server/tests/integracao/tarifas.test.ts`: mudar a tabela não altera a cobrança de quem entrou antes.

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/v1/sessoes/:id` · `/sessoes/abertas` | Ticket(s) com `calculo` (valor agora, itens, saldo, `proximaCobranca`) |
| POST | `/api/v1/sessoes/:id/previa-saida` | Prévia da saída: `{ descontoCentavos, acrescimoCentavos, pagamentos }` → valores, pagamentos conferidos, troco e problemas. Não grava nada |
| POST | `/api/v1/sessoes/:id/saida` | Encerra com as mesmas contas da prévia. `valorCentavos: null` = pagamento que completa o restante |
| POST | `/api/v1/tarifas/simular` | Simulador e prévia do formulário de tarifa: `{ regraIds \| regra, duracoes, modalidade }` |
