# Sincronização com a nuvem (a implementar)

Worker separado da API que envia os eventos da tabela `sync_outbox` para a API
externa e, no futuro, busca itens da `sync_inbox`.

Arquivos previstos (ver `docs/ARQUITETURA.md` §2.3 e §6):

| Arquivo | Função |
|---------|--------|
| `outbox.ts` | Grava eventos na mesma transação da alteração de negócio |
| `pusher.ts` | Envia lotes ordenados por `seq`, assinados com HMAC |
| `puller.ts` | Busca a inbox (futuro: mensalistas, Pix online) |
| `worker.ts` | Processo próprio (serviço do Windows) com retry e backoff |
