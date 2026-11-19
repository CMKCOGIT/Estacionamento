# Gerenciamento de Vagas

Menu **Vagas** do painel. Código em `apps/local-server/src/modules/vagas` e `apps/admin-web/src/pages/Vagas.tsx`.

## Situação de cada vaga

| Cor no mapa | Situação | Significado |
|-------------|----------|-------------|
| 🟩 Verde (✓) | **Disponível** | Ativa e sem veículo |
| 🟥 Vermelho (●) | **Ocupada** | Tem um ticket aberto. Mostra a placa e há quanto tempo o veículo está lá |
| ⬜ Cinza (⊘) | **Bloqueada** | Bloqueio manual (manutenção, reserva, obra...), com motivo, data e responsável |
| Tracejada | **Removida** | Saiu do mapa e da capacidade, mas o histórico foi preservado. Só aparece com "Mostrar removidas" |

- **Cada situação também tem ícone e texto,** para não depender só da cor (daltonismo).
- **A situação não é digitada: é calculada.** "Ocupada" vem dos tickets abertos, então qualquer entrada ou saída muda a vaga na hora.
- **O mapa atualiza sozinho a cada 10 s,** e na hora depois de qualquer ação feita na tela.

## Regras

| Regra | Onde é garantida |
|-------|------------------|
| **Uma vaga nunca tem dois veículos ao mesmo tempo** | Índice único no banco (`uq_sessoes_vaga_aberta`). Com dois operadores ao mesmo tempo, o MySQL pode acusar *deadlock*; a transação é repetida e o segundo recebe "Esta vaga já está ocupada por outro veículo." (teste automático com duas entradas simultâneas) |
| Código único por estacionamento; letras, números e hífen | Banco (`uq_vagas_codigo`, `ck_vagas_codigo`) e API |
| Vaga ocupada não pode ser bloqueada, excluída nem mudar de categoria | API (mensagem com a placa) e trigger |
| Bloquear exige motivo; liberar limpa o bloqueio | API e `ck_vagas_bloqueio` |
| Categoria com vagas não pode ser desativada | Trigger `trg_categorias_bu` |

## Excluir respeitando o histórico

| A vaga... | "Excluir" faz | Por quê |
|-----------|---------------|---------|
| **nunca** recebeu veículos | **Exclui** de verdade | Não há registro que dependa dela |
| **já** recebeu veículos | **Desativa** (vira *Removida*) | Os tickets antigos apontam para ela. Pode ser **reativada** depois |

As duas operações pedem motivo e ficam no histórico de atividades.

## Capacidade

A **capacidade** de uma categoria é o número de vagas **disponíveis + ocupadas + bloqueadas**. As removidas não contam.

Há duas formas de alterar a capacidade:

1. **Vaga a vaga:** cadastrar (uma ou em lote, ex.: `A-01` a `A-20`) ou excluir.
2. **Configurar capacidade:** você informa o novo total, e o sistema decide.
   - **Para aumentar:** primeiro **reativa** as vagas removidas da categoria; depois **cria** as que faltarem, continuando a numeração do prefixo (ex.: depois de `M-10` vem `M-11`). Códigos de vagas apagadas não são reaproveitados.
   - **Para reduzir:** remove primeiro as **bloqueadas**, depois as **livres de código mais alto**. **Vagas ocupadas nunca são removidas.** Se não houver vagas livres suficientes, a operação é recusada e informa o mínimo possível no momento.

Cada mudança grava uma linha em `capacidade_alteracoes` (antes, depois, quais vagas, motivo e quem fez) e no histórico geral (`vaga.capacidade_alterada`).

**Bloquear não altera a capacidade:** a vaga continua existindo, só fica fora de uso.

## Sincronização

Toda alteração grava, **na mesma transação**, o evento `vagas.disponibilidade` na `sync_outbox`, com os totais por categoria. É ele que o worker de sincronização (etapa futura) vai enviar para o PWA dos clientes.

## Permissões

| Ação | Permissão |
|------|-----------|
| Ver o mapa | `vaga.gerenciar`, `vaga.capacidade`, `sessao.consultar`, `sessao.entrada` ou `relatorio.operacional` |
| Cadastrar, editar, bloquear, liberar, excluir, reativar, categorias | `vaga.gerenciar` |
| Configurar capacidade | `vaga.capacidade` |

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/v1/vagas?categoriaId=&setor=&estado=&busca=&incluirRemovidas=` | Mapa com situação, resumo e setores |
| GET | `/api/v1/vagas/:id` | Detalhe e últimos usos |
| POST | `/api/v1/vagas` · `/api/v1/vagas/lote` | Cadastrar uma ou várias |
| PATCH | `/api/v1/vagas/:id` | Editar |
| POST | `/api/v1/vagas/:id/bloquear` (motivo) · `/liberar` | Bloqueio manual |
| POST | `/api/v1/vagas/:id/remover` (motivo) · `/reativar` | Excluir ou desativar / reativar |
| PUT | `/api/v1/vagas/capacidade` | Definir a capacidade de uma categoria |
| GET · POST · PATCH | `/api/v1/categorias` | Categorias de veículo |
