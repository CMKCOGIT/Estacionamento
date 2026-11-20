# API externa (nuvem) — API pública do app do cliente

Somente leitura, somente `/v1` (vagas, tarifas e o ticket pelo token). Sem
nenhuma rota administrativa. HTTPS obrigatório em produção, CORS só para o app.
Detalhes em [`docs/PWA.md`](../../docs/PWA.md).

```bash
cp apps/cloud-api/.env.example apps/cloud-api/.env   # ajuste o banco e PWA_ORIGENS
npm run db:migrar -w @estacionamento/cloud-api        # cria/atualiza o banco da nuvem
npm run nuvem:dev                                     # http://localhost:8090
npm run espelhar:local -w @estacionamento/cloud-api   # (dev) copia dados do banco local
npm run test:integracao -w @estacionamento/cloud-api  # testes (MySQL)
```

A sincronização automática com o servidor local (`/sync`, ARQUITETURA §6) é um
módulo à parte, ainda a implementar; ela vai alimentar as mesmas tabelas.
