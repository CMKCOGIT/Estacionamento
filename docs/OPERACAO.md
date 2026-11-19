# Entrada e saída de veículos

Menu **Entrada e saída** do painel (`/operacao`).

- **Backend:** `apps/local-server/src/modules/sessoes` (`sessoes.*`, `caixa.service.ts`, `acesso-cliente.ts`).
- **Tela:** `apps/admin-web/src/pages/Operacao.tsx` e `components/operacao/*`.

Tudo roda **no servidor local**, com o MySQL local:

- o QR Code é gerado no próprio servidor;
- o cálculo do valor usa o relógio do banco;
- os eventos para a nuvem ficam guardados na fila (`sync_outbox`) e sobem quando houver internet.

Sem internet, o único recurso que não funciona é o botão "Enviar no WhatsApp", porque ele abre o site do WhatsApp.

## Entrada

1. **Placa:** o operador digita a placa. Enquanto digita, o sistema reconhece o veículo:
   - **veículo já cadastrado:** usa a categoria dele e mostra modelo, cor e o número de visitas;
   - **placa nova:** pede a categoria (modelo e cor são opcionais) e cadastra o veículo junto com a entrada;
   - **veículo que já está dentro:** a entrada é bloqueada e aparece o atalho "Ir para a saída".
2. **Vaga:** "Automática" pega a primeira vaga livre da categoria, pela ordem setor e código. O operador também pode escolher uma vaga livre da lista. A tela mostra quantas vagas livres ainda há.
3. **Cobrança:** por tempo (avulso) ou diária.
   **Tarifa:** automática (a padrão ou a especial do dia/horário) ou uma especial escolhida, como um convênio. A tarifa usada fica gravada no ticket e não muda se os preços mudarem depois (ver [TARIFAS.md](TARIFAS.md)).
4. **Registrar entrada** grava o **horário do servidor**, ocupa a vaga e cria o **ticket** (sessão). O ticket tem:
   - **número sequencial** (nº 125...), usado para localizar no balcão;
   - **código secreto exclusivo** (32 bytes aleatórios), que vai no **link individual** do cliente (`.../cliente/t#código`).

   O banco guarda só o *hash* do código. Por isso o link aparece **só nesse momento**. Se o cliente perder, use **Novo link**: o anterior deixa de valer.
5. A tela mostra o **QR Code** para o cliente ler na tela (ou num monitor voltado para ele), com os botões **Copiar link** e **Enviar no WhatsApp**.

O endereço do link vem de `PUBLIC_PWA_URL` no `.env`, quando o app do cliente estiver publicado. Sem essa variável, o link aponta para o próprio servidor local (`/cliente`).

## Saída

1. **Localizar:** digite a placa ou o nº do ticket, ou clique em **Saída** na lista "No estacionamento agora".
2. **Cálculo:** a tela mostra a entrada, a permanência, a tarifa aplicada e o **valor a pagar**:
   - o valor é recalculado a cada 30 s;
   - se ele mudar (passou de uma fração de tempo), a tela avisa.
3. **Pagamento (presencial):**
   - **Formas:** dinheiro, Pix, débito ou crédito.
   - **Dividir em outra forma:** a primeira linha completa automaticamente o que faltar.
   - **Dinheiro:** informe o *recebido* para calcular o **troco**.
   - **Desconto:** só para quem tem a permissão "Conceder desconto" e exige motivo.
   - **Tolerância:** dentro dela, não há cobrança e a saída não pede pagamento.
4. **Registrar saída**, numa única transação:
   1. grava o horário de saída;
   2. registra os pagamentos e as movimentações no **caixa do operador**;
   3. **libera a vaga**;
   4. **encerra o ticket**;
   5. agenda os eventos para a nuvem.

   O link do cliente continua mostrando o recibo por 24 h.

## Caixa

Para receber pagamentos, o operador precisa estar com o **caixa aberto**. A barra no topo da tela mostra:

- a situação do caixa;
- o dinheiro que deve estar na gaveta;
- o total recebido em cada forma.

| Ação | O que acontece |
|------|----------------|
| **Abrir caixa** | Informa o dinheiro para troco. Se não existir guichê cadastrado, cria o "Guichê 1". |
| **Fechar caixa** | Informa o dinheiro contado. Se houver diferença, a observação é obrigatória e fica registrada. |
| Saída com caixa fechado | A tela oferece **Abrir caixa agora** e depois conclui a saída. |

Sangria, suprimento e a supervisão de vários caixas ficam para o módulo de Caixa.

## Validações (o que o sistema impede)

| Situação | Resposta | Onde é garantido |
|----------|----------|------------------|
| Entrada sem vaga disponível | "Não há vagas disponíveis para Carro. O estacionamento está lotado nessa categoria." | Serviço, com a vaga travada no banco (`FOR UPDATE SKIP LOCKED`) |
| Mesmo veículo entrando duas vezes | "O veículo ABC1D23 já está estacionado na vaga A-01 desde..." | Serviço + índice único `uq_sessoes_veiculo_aberto` |
| Vaga escolhida já ocupada | "A vaga A-01 já está ocupada pelo veículo..." | Serviço + índice único `uq_sessoes_vaga_aberta` |
| Vaga bloqueada, removida ou de outra categoria | Mensagem específica | Serviço |
| Dois guichês disputando a última vaga ao mesmo tempo | Um entra; o outro recebe "lotado" | Trava da vaga + nova conferência com leitura atual + nova tentativa automática |
| Saída de veículo sem ticket aberto | "Não há nenhum ticket para a placa..." ou "...já foi encerrado" | Serviço |
| Encerrar o mesmo ticket duas vezes (dois cliques, dois guichês) | Só a primeira vale; a segunda recebe "já foi encerrado" e nenhum pagamento é duplicado | Trava do ticket + `UPDATE ... WHERE status='ABERTA'` + chave de idempotência do pagamento |
| Valor mudou entre a conferência e a confirmação | Pede nova conferência com o valor novo | Serviço compara com o valor que o operador viu |
| Pagamentos não fecham o valor | "Os pagamentos somam X, mas o valor a pagar é Y." | Serviço |
| Entrada sem tarifa publicada para a categoria | "Não há tabela de tarifas publicada..." | Serviço |

## Cancelamento e novo link

- **Cancelar** (permissão "Cancelar sessão"): serve para uma entrada feita por engano. Exige motivo, libera a vaga e não cobra nada. Também invalida o link do cliente. Um ticket que já tem pagamento não pode ser cancelado.
- **Novo link** (permissão "Revogar e gerar novo QR/link"): gera um QR/link novo e o anterior para de funcionar na hora.

Tudo fica no **histórico de atividades**, com o operador, o horário e o motivo.

## Permissões usadas

| Permissão | Libera |
|-----------|--------|
| `sessao.entrada` | Registrar entradas |
| `sessao.saida` | Registrar saídas |
| `pagamento.registrar` + `caixa.operar` | Receber pagamentos, abrir e fechar o próprio caixa |
| `sessao.ajustar_valor` | Conceder desconto |
| `sessao.cancelar` | Cancelar ticket |
| `sessao.token_revogar` | Gerar novo link |

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/v1/sessoes/abertas` | Veículos no estacionamento agora, com o valor até o momento |
| GET | `/api/v1/sessoes/localizar?termo=` | Ticket pela placa ou pelo número |
| GET | `/api/v1/sessoes/:id` | Ticket com cálculo atualizado |
| GET | `/api/v1/sessoes/vagas-livres?categoriaId=` | Vagas livres da categoria |
| POST | `/api/v1/sessoes/entrada` | Registra a entrada (devolve o ticket, o link e o QR) |
| POST | `/api/v1/sessoes/:id/saida` | Registra a saída com os pagamentos |
| POST | `/api/v1/sessoes/:id/cancelar` | Cancela o ticket (com motivo) |
| POST | `/api/v1/sessoes/:id/novo-link` | Gera um novo link/QR e revoga o anterior |
| GET | `/api/v1/caixa/atual` · `/formas` · `/postos` | Caixa do operador, formas de pagamento e guichês |
| POST | `/api/v1/caixa/abrir` · `/fechar` | Abrir e fechar o próprio caixa |
