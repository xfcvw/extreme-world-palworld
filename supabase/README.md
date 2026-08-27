# Supabase — Extreme World Palworld

O projeto usa Supabase para autenticação Discord, perfis, carteiras, pedidos, catálogo e histórico.

Project URL usada pelo frontend:
`https://mujvmfkoeaklefwlwbnk.supabase.co`

As chaves privadas NÃO estão incluídas neste ZIP. Configure-as apenas nas variáveis de ambiente da Vercel usando `.env.example` como referência.

## Cargos do Discord

O portal sincroniza os cargos de equipe durante o login por meio de um bot que
esteja dentro do servidor Discord. Na Vercel, configure `DISCORD_BOT_TOKEN`,
`DISCORD_GUILD_ID` e os IDs dos cargos `OWNER`, `ADMIN` e `SUPPORT`. O token
do bot é usado exclusivamente pela função `/api/discord-sync` e nunca é
enviado ao navegador.

Principais tabelas utilizadas pelo projeto:
- profiles
- wallets
- wallet_transactions
- game_servers
- categories
- vip_plans
- vip_benefits
- pals
- pal_prices
- products
- coupons
- orders
- order_items
- payments
- coupon_usages
- reviews
- admin_logs
- webhook_events

Principais RPCs usados:
- process_mercado_pago_payment
- purchase_pal_with_victory_coins
- staff_set_order_delivery_status

O schema de produção permanece no projeto Supabase já configurado.
