# App do cliente (PWA) — "Meu Ticket"

App instalável no celular: vagas livres, preços e o próprio ticket, aberto pelo
link ou QR Code. Consome só a API pública externa (`apps/cloud-api`). Não tem
nenhuma função administrativa. Detalhes em [`docs/PWA.md`](../../docs/PWA.md).

```bash
npm run pwa:dev                                  # desenvolvimento (http://localhost:5174)
npm run build -w @estacionamento/pwa             # produção (VITE_API_URL=https://...)
npm run preview -w @estacionamento/pwa           # serve o build (testa instalação e offline)
npm run icones -w @estacionamento/pwa            # regenera os PNG a partir de public/icones/icone.svg
```
