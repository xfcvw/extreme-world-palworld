# Extreme World Palworld

Projeto independente da loja Extreme World.

## Estrutura
- `index.html`: loja pública + login Discord + carteira + Pals
- `admin.html`: painel de equipe
- `api/checkout.js`: cria preferência Mercado Pago
- `api/webhook.js`: valida webhook Mercado Pago e credita moedas / cria fila de entrega

## Variáveis na Vercel
Use `.env.example` como referência. Nunca publique `SUPABASE_SERVICE_ROLE_KEY`, `MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_WEBHOOK_SECRET` ou `PAYPAL_CLIENT_SECRET` no frontend.

## PayPal internacional

O PayPal é usado apenas para comprar pacotes de Moedas da Vitória em USD. A loja de Pals, armas, armaduras, recursos e esferas usa exclusivamente o saldo de Moedas da Vitória.

Na Vercel, configure `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` e `PAYPAL_ENV` (`sandbox` para testes ou `live` para produção). O Client Secret permanece somente nas funções da Vercel.

## Supabase
Projeto: `Extreme World Palworld`
Ref: `mujvmfkoeaklefwlwbnk`

## Discord
O provider Discord deve estar habilitado no Supabase e a aplicação Discord deve conter a callback:
`https://mujvmfkoeaklefwlwbnk.supabase.co/auth/v1/callback`

Após definir o domínio da Vercel, adicione o domínio em Authentication > URL Configuration > Redirect URLs.
