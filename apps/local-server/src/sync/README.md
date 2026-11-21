# Sincronização com a nuvem

Envia a fila `sync_outbox` para a API externa (`/sync/v1`). Detalhes em
[`docs/API-EXTERNA.md`](../../../../docs/API-EXTERNA.md).

| Arquivo        | Função                                                                       |
| -------------- | ---------------------------------------------------------------------------- |
| `outbox.ts`    | Grava eventos na mesma transação da alteração de negócio                     |
| `projecoes.ts` | O que pode sair do estacionamento (projeções públicas)                       |
| `cliente.ts`   | Chamada HTTPS assinada com HMAC                                              |
| `worker.ts`    | Carga completa, lotes em ordem, sinal de vida, novas tentativas, dead-letter |
| `index.ts`     | Liga o worker pelo `.env` e informa a situação ao painel                     |

Futuro: `puller.ts` para buscar a `sync_inbox` (mensalistas, Pix online).
