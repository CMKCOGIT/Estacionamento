# API externa (nuvem)

- `/v1`: consulta do cliente (vagas, tarifas e o ticket pelo token). Somente leitura.
- `/sync/v1`: recebe os dados do servidor local (autenticação HMAC por estacionamento).

Sem nenhuma rota administrativa, operacional ou financeira. HTTPS obrigatório em
produção. Rotas, dados públicos, segurança e registro:
[`docs/API-EXTERNA.md`](../../docs/API-EXTERNA.md) e [`openapi.yaml`](openapi.yaml).

```bash
cp apps/cloud-api/.env.example apps/cloud-api/.env   # ajuste o banco e PWA_ORIGENS
npm run db:migrar -w @estacionamento/cloud-api        # cria/atualiza o banco da nuvem
npm run nuvem:dev                                     # http://localhost:8090
npm run integracao -w @estacionamento/cloud-api -- criar --nome "Centro"  # credencial do servidor local
npm run test:integracao -w @estacionamento/cloud-api  # testes (MySQL)
```

