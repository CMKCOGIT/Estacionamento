# Gerenciamento de Veículos

Menu **Veículos** do painel. Código em `apps/local-server/src/modules/veiculos` e `apps/admin-web/src/pages/Veiculos.tsx` / `VeiculoDetalhe.tsx`.

## Identificação pela placa

- **A placa é a identidade do veículo** no estacionamento. Há um cadastro por placa (`uq_veiculos_placa`).
- A placa é sempre **normalizada**: `abc-1d23`, `ABC 1D23` e `ABC1D23` são a mesma placa. Por isso não é possível cadastrar a mesma placa duas vezes escrevendo de outro jeito. Ao tentar, o sistema avisa e oferece **abrir o cadastro existente**.
- Formatos aceitos:
  - **padrão antigo** `ABC1234`;
  - **Mercosul** `ABC1D23`;
  - **placa estrangeira**, com 4 a 10 letras e números, quando marcada no cadastro.
- **Consulta por placa:** o campo "Consultar placa" vai direto para o cadastro. Se a placa ainda não existir, o sistema oferece cadastrá-la.

## Um veículo, várias estadias

Cada entrada cria uma **sessão de estacionamento** (ticket) ligada ao veículo. A tela do veículo mostra:

- **Situação agora:**
  - se está estacionado, aparecem a vaga, a entrada, a permanência e o **valor em aberto estimado**, calculado com a mesma função de tarifa do caixa, menos o que já foi pago;
  - se não está, aparece a data da última visita.
- **Resumo:** quantidade de estadias, canceladas, tempo médio, tempo total, total pago e data da primeira visita.
- **Histórico de estadias,** da mais recente para a mais antiga: ticket, entrada, saída, permanência, vaga, valor, situação e quem atendeu.

A **primeira e a última visita** são atualizadas pelo próprio banco a cada entrada (trigger), então nunca ficam desatualizadas.

## Regra: no máximo uma estadia aberta por veículo

| Camada | Como garante |
|--------|--------------|
| Serviço | `exigirVeiculoForaDoEstacionamento()` recusa a entrada e diz onde o veículo está: "O veículo ABC1D23 já está estacionado na vaga A-03 desde 19/11 14:20 (ticket nº 512)…". O registro de entrada vai usá-la |
| Banco | Índice único `uq_sessoes_veiculo_aberto`: vale mesmo que alguém pule a regra. **Testado com duas entradas simultâneas** do mesmo veículo em vagas diferentes: só uma é aceita |
| Banco | O ticket só aceita a placa **do próprio veículo** e do mesmo estacionamento (trigger `trg_sessoes_bi_veiculo`) |

## Histórico preservado

- **Corrigir a placa** de um cadastro:
  - os tickets **antigos continuam com a placa da época**, e o histórico mostra "placa na época: …";
  - se o veículo estiver estacionado, o ticket aberto passa a usar a placa corrigida;
  - a correção fica no histórico de atividades (`veiculo.placa_corrigida`), com o motivo.
- **Excluir:** só é possível para veículos **sem nenhuma estadia** (cadastrado por engano). Com estadias, o cadastro é mantido para sempre.
- Cadastros e edições ficam registrados no histórico de atividades (`veiculo.cadastrado`, `veiculo.alterado`).

## Permissões

| Ação | Permissão |
|------|-----------|
| Consultar, ver histórico e estacionados | `veiculo.gerenciar`, `sessao.consultar`, `sessao.entrada`, `sessao.saida` ou `relatorio.operacional` |
| Cadastrar, editar, excluir | `veiculo.gerenciar` |

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/veiculos?busca=&categoriaId=&estacionados=true&pagina=` | Lista (estacionados primeiro) com situação atual |
| GET | `/api/v1/veiculos/placa/:placa` | Consulta por placa (aceita hífen e minúsculas) |
| GET | `/api/v1/veiculos/:id` | Cadastro, estadia atual e estatísticas |
| GET | `/api/v1/veiculos/:id/estadias?pagina=&limite=` | Histórico de estadias |
| POST | `/api/v1/veiculos` | Cadastrar |
| PATCH | `/api/v1/veiculos/:id` | Editar (`motivo` opcional, usado na correção de placa) |
| POST | `/api/v1/veiculos/:id/remover` | Excluir (só sem estadias; `motivo` obrigatório) |
