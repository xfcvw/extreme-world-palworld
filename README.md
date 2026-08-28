# Extreme World Palworld

Projeto independente da loja Extreme World.

## Estrutura
- `index.html`: loja pública + login Discord + carteira + Pals
- `admin.html`: painel de equipe
- `api/checkout.js`: cria preferência Mercado Pago
- `api/webhook.js`: valida webhook Mercado Pago e credita moedas / cria fila de entrega

## Variáveis na Vercel
Use `.env.example` como referência. Nunca publique `SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN` ou `MERCADO_PAGO_WEBHOOK_SECRET` no frontend.

## Supabase
Projeto: `Extreme World Palworld`
Ref: `mujvmfkoeaklefwlwbnk`

## Discord
O provider Discord deve estar habilitado no Supabase e a aplicação Discord deve conter a callback:
`https://mujvmfkoeaklefwlwbnk.supabase.co/auth/v1/callback`

Após definir o domínio da Vercel, adicione o domínio em Authentication > URL Configuration > Redirect URLs.
