# Backup e recuperação do banco local

O banco MySQL do servidor local tem **todos** os registros operacionais e financeiros. A nuvem tem só uma cópia parcial, o que o app do cliente vê. **O backup é a única forma de recuperar os dados se o computador falhar.**

## Como funciona

| Item | Como |
|------|------|
| **Automático** | Todo dia às `BACKUP_HORA` (padrão 03:00). Se o computador estava desligado nesse horário, faz o backup 2 minutos depois de ligar (quando o último tem mais de 26 h) |
| **Manual** | Painel → **Backups → Fazer backup agora**, ou `Fazer-Backup.cmd` |
| **Sem parar o estacionamento** | `mysqldump --single-transaction`: fotografia consistente do banco **sem travar as tabelas**. Entradas, saídas e pagamentos continuam durante o backup (há teste disso). O processo roda com prioridade baixa no processador |
| **Conteúdo** | Tabelas, dados, gatilhos (triggers), procedimentos e eventos. Tudo o que é preciso para o sistema funcionar |
| **Armazenamento seguro** | Compactado (gzip) e **criptografado com AES-256-GCM**. Sem a chave, o arquivo não pode ser lido; qualquer alteração faz a decifragem falhar. Os arquivos ficam com permissão só do dono. O arquivo é gravado como `.parcial` e só é renomeado quando completo |
| **Segunda cópia** | `BACKUP_COPIA_DIR`: pen drive, outro computador da rede ou uma pasta sincronizada com OneDrive/Google Drive. A cópia é conferida pelo hash |
| **Histórico** | Tabela `backups` (painel → Backups) e um **manifesto `.json` ao lado de cada arquivo**: se o banco se perder, a pasta sozinha diz o que restaurar |
| **Registro de falhas** | Falha fica no histórico com o motivo (sem dados pessoais), no histórico de atividades (`backup.falhou`) e no log. O painel mostra em vermelho: falha, backup atrasado (mais de 26 h) ou arquivo com problema |
| **Retenção** | Últimos **7 diários, 4 semanais e 12 mensais** (`BACKUP_RETER_*`). O mais recente fica sempre. Registros de falha saem depois de 90 dias |
| **Integridade** | Logo depois de criar, e **todo dia** para todos os guardados: (1) SHA-256 do arquivo igual ao registrado; (2) a chave decifra e a tag GCM confere; (3) o gzip abre; (4) o SQL termina com a marca de dump completo. **Uma vez por mês**, e no botão "Testar restauração", o backup é restaurado num banco temporário: as tabelas, os gatilhos e as migrações são conferidos com o manifesto, e o banco temporário é apagado depois |

## Configuração (`apps/local-server/.env`)

```ini
# Pasta dos backups (padrão: apps/local-server/backups)
BACKUP_DIR=D:\EstacionamentoBackups
# Segunda cópia — MUITO recomendada (outro disco/computador/nuvem)
BACKUP_COPIA_DIR=E:\BackupEstacionamento
# Horário diário
BACKUP_HORA=03:00
# Retenção
BACKUP_RETER_DIARIOS=7
BACKUP_RETER_SEMANAIS=4
BACKUP_RETER_MENSAIS=12
# Só se o MySQL não estiver no lugar padrão do Windows
# MYSQL_BIN_DIR=C:\Program Files\MySQL\MySQL Server 8.4\bin
```

O `mysqldump` e o `mysql` vêm com a instalação do MySQL. O sistema procura em `C:\Program Files\MySQL\MySQL Server *\bin`.

O usuário do banco (`DB_USER`) precisa de permissão para:
- ler tudo, inclusive gatilhos e procedimentos;
- criar e apagar o banco temporário `<DB_NAME>_teste_restauracao`.

### A chave de criptografia — guarde uma cópia fora deste computador

Na primeira vez, a chave é gerada em `apps/local-server/segredos/backup.chave`. No painel, aparece só a **impressão** dela (16 caracteres), que identifica qual chave abre cada backup.

> **Sem a chave, nenhum backup pode ser restaurado.** Se o computador queimar, a chave vai junto com ele.

Guarde uma cópia do conteúdo do arquivo (uma linha de 44 caracteres):
- num gerenciador de senhas, ou
- impressa, num envelope lacrado guardado com o dono.

Uma alternativa é definir `BACKUP_CHAVE=<a mesma linha>` no `.env`. A chave nunca vai para o Git (`.gitignore`).

## Recuperação

### A) O computador do servidor quebrou ou o disco morreu

O que você precisa:
- um backup (da segunda cópia, se o disco do servidor morreu);
- a chave.

1. **Instale o sistema** num computador novo:
   - MySQL 8.4 e Node.js;
   - o projeto, como na primeira instalação (README → "Instalação");
   - o `apps/local-server/.env` com o banco e a senha.
2. **Coloque a chave:**
   - copie `backup.chave` para `apps/local-server/segredos/`, ou
   - ponha `BACKUP_CHAVE=` no `.env`.
3. **Copie os backups** (arquivos `.sql.gz.enc` e os `.json` ao lado) para a pasta de backups (`BACKUP_DIR`).
4. Rode o **Atualizar.cmd** para criar a estrutura.
5. Rode o **Restaurar-Backup.cmd**:
   - ele lista os backups e pergunta qual restaurar (Enter = o mais recente);
   - pede para digitar `RESTAURAR`;
   - apaga o banco e coloca o do backup.
6. Rode o **Atualizar.cmd** de novo. Se o backup for de uma versão anterior do sistema, as migrações que faltam são aplicadas.
7. Abra o **Iniciar.cmd** e confira no painel:
   - **Backups:** o histórico volta, lido dos manifestos da pasta;
   - **Configurações → Sincronização:** "Ressincronizando", depois "Em dia";
   - os tickets em aberto, em **Entrada e saída**.

### B) Dados apagados ou estragados por engano (o computador está bom)

1. Feche o **Iniciar.cmd** (servidor parado).
2. Antes de mexer, rode o **Fazer-Backup.cmd**. Isso guarda o estado atual, caso seja preciso voltar.
3. Rode o **Restaurar-Backup.cmd** e escolha o backup de **antes** do problema.
4. Abra o **Iniciar.cmd**.

**Atenção:** o que foi feito entre o backup e agora se perde (por exemplo, as entradas da manhã). Confira os veículos no pátio e registre de novo as entradas que faltarem.

### C) Só quero testar se os backups funcionam

Painel → **Backups → Testar restauração**. O backup é restaurado num banco temporário, conferido e apagado, sem mexer no banco em uso.

### Depois de qualquer restauração: a nuvem

A restauração marca a sincronização para uma **carga completa** e uma **conferência**. O servidor local, que é a fonte da verdade, reenvia o estado restaurado. A nuvem apaga os tickets que não existem mais aqui ([SINCRONIZACAO.md](SINCRONIZACAO.md)).

Links de clientes criados depois do backup deixam de funcionar. Se for preciso, gere um "novo link" no caixa.

### Linha de comando (alternativa aos .cmd)

```bash
npm run backup -w @estacionamento/local-server -- criar
```

```bash
npm run backup -w @estacionamento/local-server -- listar
```

```bash
npm run backup -w @estacionamento/local-server -- verificar
```

```bash
npm run backup -w @estacionamento/local-server -- restaurar --arquivo backup-20261121-030000-auto.sql.gz.enc --confirmar
```

```bash
npm run backup -w @estacionamento/local-server -- restaurar --banco estacionamento_copia --confirmar
```

O último comando restaura em **outro** banco, para consultar dados antigos sem mexer no atual.

### Se a restauração falhar

| Mensagem | O que fazer |
|----------|-------------|
| "Não foi possível decifrar: arquivo alterado ou chave diferente" | A chave não é a do backup (compare a impressão no `.json`, campo `chaveId`) ou o arquivo foi danificado. Tente a segunda cópia ou outro backup |
| "Programa mysql não encontrado" | Configure `MYSQL_BIN_DIR` com a pasta `bin` do MySQL |
| "Access denied" | O `DB_USER` do `.env` precisa de permissão para criar o banco |
| Arquivo corrompido em todos | Use a segunda cópia (`BACKUP_COPIA_DIR`) |

## Recomendações

1. **Configure a segunda cópia.** Um backup só no mesmo disco não protege contra a perda do disco.
2. Guarde a chave fora do computador.
3. Uma vez por mês, olhe o painel → Backups: tudo verde, e a "Restauração testada" recente.
4. Antes de atualizar o sistema ou mexer no banco, faça um backup manual.

## Testes

`apps/local-server/tests/integracao/backup.test.ts`:
- o backup é feito **com entradas acontecendo ao mesmo tempo** e as entradas funcionam;
- o arquivo é criptografado (nada legível), com manifesto e hash;
- o teste de restauração confere tabelas, gatilhos e migrações e não toca no banco em uso;
- arquivo alterado é apontado como "corrompido", arquivo sumido como "ausente", e o bom volta a "OK";
- a falha é registrada com o motivo e aparece no painel e no histórico;
- a retenção funciona: diários, semanais e mensais, com arquivo e manifesto apagados;
- só quem tem `backup.gerenciar` acessa.

Os testes precisam do `mysqldump` (`MYSQL_BIN_DIR` ou o PATH). Sem ele, são pulados.
