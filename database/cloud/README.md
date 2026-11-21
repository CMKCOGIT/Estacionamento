# Banco da nuvem

Modelo de leitura consultado pela API externa, alimentado pela sincronização do
servidor local:

| Tabela | Conteúdo |
|--------|----------|
| `sites_publicos`, `disponibilidade_publica`, `tarifas_publicas` | Estacionamento, vagas e preços (públicos) |
| `tickets_publicos`, `tickets_tokens` | Tickets (placa é o único dado pessoal) e só o **hash** do token do link |
| `integracoes` | Credenciais de quem envia dados (o segredo não fica no banco) |
| `sync_aplicados`, `sync_estado`, `sync_nonces` | Idempotência, último seq/contato e proteção contra replay |
| `registro_api` | Requisições relevantes e erros (sem tokens nem IP em claro) |

Sem usuários, caixa, pagamentos individuais ou cadastros. Aplicado por
`npm run db:migrar -w @estacionamento/cloud-api`. Ver `docs/API-EXTERNA.md`.
