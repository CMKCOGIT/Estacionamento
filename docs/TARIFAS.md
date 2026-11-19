# Gerenciamento de tarifas

Menu **Tarifas** do painel (`/tarifas`).

- **Backend:** `apps/local-server/src/modules/tarifas` (`tarifas.*`, `selecao.ts`, `regra.ts`).
- **Cálculo:** `packages/shared/src/tarifa.ts`. É a mesma função usada pelo caixa, pelo painel, pelo simulador e, no futuro, pelo app do cliente.
- **Banco:** `database/local/009_tarifas.sql`.

## O que o administrador configura

Cada **categoria de veículo** (Carro, Moto...) tem uma **tarifa padrão** e pode ter **tarifas especiais**.

| Campo | Exemplo | Significado |
|-------|---------|-------------|
| 1ª hora | R$ 10,00 | Cobrada assim que passa da tolerância |
| Hora adicional | R$ 6,00 | Cada hora depois da 1ª |
| Fração de hora | 15 min por R$ 2,00 | Opcional. Sem fração, o tempo que sobra conta como hora cheia. A soma das frações nunca passa do valor da hora adicional |
| **Arredondamento** | carência de 5 min | Minutos de carência em cada período (hora ou fração) depois da 1ª hora. **0 = para cima**: qualquer minuto iniciado cobra o período |
| Diária máxima | R$ 40,00 | Opcional. Teto a cada 24h no modo por tempo |
| Diária | R$ 35,00 | Opcional. Preço do modo "Diária", escolhido na entrada |
| Tolerância | 10 min | Quem sai até esse tempo não paga nada |
| Preço fixo | R$ 25,00 | Só em tarifas especiais. Valor único a cada 24h, no lugar de hora e fração |

**Exemplo de arredondamento**, com fração de 15 min:

| Permanência | Carência 0 | Carência 5 |
|-------------|------------|------------|
| 1h05 | 1ª hora + 1 fração | só a 1ª hora |
| 1h06 | 1ª hora + 1 fração | 1ª hora + 1 fração |
| 1h20 | 1ª hora + 2 frações | 1ª hora + 1 fração |

### Tarifas especiais

- **Automática:** vale sozinha conforme o **dia da semana** e/ou o **horário de entrada**. Exemplos: "Fim de semana" (sáb e dom) ou "Noturno" (entradas das 18:00 às 06:00).
  - Um horário que atravessa a meia-noite pertence ao dia em que começou: a madrugada de sábado conta como sexta.
  - Só se aplica ao modo por tempo. A diária usa sempre a padrão.
  - Se duas especiais automáticas valerem ao mesmo tempo, vale a primeira cadastrada.
- **Escolhida pelo operador:** por exemplo convênio ou evento. Aparece no campo "Tarifa" da entrada.

Na entrada, o sistema usa:

1. a tarifa escolhida pelo operador; senão
2. a especial automática do momento; senão
3. a padrão.

A tela mostra qual tarifa será usada antes de confirmar a entrada.

## Cadastrar, editar e desativar: sempre numa nova versão

As tarifas ficam em **tabelas versionadas**.

1. **Alterar preços** cria uma **nova versão** (rascunho) com a cópia dos preços em vigor. Só existe uma versão em edição por vez. "Usar como base", no histórico, copia uma versão antiga, o que permite voltar a preços anteriores.
2. No rascunho, você pode:
   - **editar** qualquer tarifa;
   - **cadastrar** tarifas especiais (ou a padrão de uma categoria nova);
   - **desativar** ou **reativar** uma tarifa;
   - **remover** uma especial que só existe nesta versão.

   O quadro **"O que muda"** lista cada diferença em relação à versão em vigor, e o **simulador** mostra lado a lado quanto custa ficar X horas na versão em vigor e na nova.
3. **Publicar** pode ser **agora** ou **agendado** para uma data futura. Até essa data, valem os preços atuais. Um agendamento pode ser cancelado (a versão é arquivada).
4. Depois de publicada, a versão **nunca mais muda**. Para mudar de novo, crie outra versão.

Regras de proteção:

| Situação | O que acontece |
|----------|----------------|
| Editar ou excluir uma tarifa de versão publicada | Recusado pela API e pelo banco (triggers) |
| Publicar com início no passado | Recusado: a mudança não pode ser retroativa |
| Publicar sem tarifa padrão ativa para uma categoria que tem vagas | Recusado: nenhuma entrada dessa categoria seria aceita |
| Arquivar a versão em vigor | Recusado: sempre existe um preço valendo. Para substituí-la, publique outra |
| Duas tarifas padrão para a mesma categoria na mesma versão | Recusado (índice único) |
| Tolerância acima de 240 min, carência maior ou igual ao período, fração incompleta, diária máxima menor que a 1ª hora | Recusado no formulário, na API e no banco (CHECKs) |

## Histórico das sessões e rastreabilidade financeira

**Mudar o preço não altera nenhuma cobrança já iniciada ou encerrada.**

- **Na entrada,** o ticket grava:
  - `tarifa_regra_id`: a regra da versão publicada;
  - `tarifa_aplicada`, uma **cópia completa** com:
    - todos os valores da regra;
    - a versão e o nome da tabela;
    - o início da vigência;
    - se foi padrão, especial automática ou especial escolhida pelo operador.

  A saída é calculada **por essa cópia**, nunca pela tabela atual.
- **Na saída,** o ticket grava `calculo_detalhe`:
  - a permanência;
  - os itens do cálculo (1ª hora, horas adicionais, frações, teto...);
  - o valor calculado;
  - o desconto e o acréscimo;
  - o valor final.

  O recibo e a tela de saída mostram esses mesmos itens.
- O banco **impede** alterar `tarifa_aplicada` ou trocar a regra de um ticket depois da entrada. Também impede encerrar um ticket sem o cálculo detalhado. Um ticket encerrado não pode ser alterado.
- A publicação registra no **histórico de atividades** a versão e **todas as regras**. A criação e o descarte de rascunhos também ficam registrados.
- A publicação gera o evento `tarifa.publicada` na fila de sincronização, para a nuvem e o app do cliente mostrarem os mesmos preços.
- O histórico de versões mostra quantos tickets foram cobrados por cada versão.

Os tickets anteriores a esta versão do sistema não têm a cópia, mas continuam ligados à regra da época, que também é imutável.

## Permissões

| Permissão | Libera |
|-----------|--------|
| `tarifa.ver` | Consultar preços, versões e o simulador |
| `tarifa.gerenciar` | Criar versão, cadastrar, editar, desativar e descartar |
| `tarifa.publicar` | Publicar, agendar e arquivar versões |

Os modelos de permissão "Operador de caixa" e "Financeiro" trazem só `tarifa.ver`. O administrador pode liberar as demais para um funcionário específico em Funcionários.

## API

| Método | Rota | Uso |
|--------|------|-----|
| GET | `/api/v1/tarifas` | Versão em vigor, rascunho, agendadas e histórico |
| GET | `/api/v1/tarifas/:id` | Uma versão com as regras |
| POST | `/api/v1/tarifas` | Nova versão em rascunho (`baseId` opcional) |
| PATCH / DELETE | `/api/v1/tarifas/:id` | Renomear ou descartar o rascunho |
| POST | `/api/v1/tarifas/:id/regras` | Cadastrar uma regra no rascunho |
| PUT / DELETE | `/api/v1/tarifas/:id/regras/:regraId` | Editar (inclusive desativar) ou remover uma regra do rascunho |
| POST | `/api/v1/tarifas/:id/publicar` | Publicar agora ou em `vigenteDesde` |
| POST | `/api/v1/tarifas/:id/arquivar` | Arquivar uma versão que não está em vigor |
| GET | `/api/v1/sessoes/tarifas?categoriaId=` | Opções de tarifa na entrada, com a que será aplicada automaticamente |
