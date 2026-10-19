# Extreme World Palworld

Plataforma web de comércio digital e gestão para a comunidade privada **Extreme World Palworld**.

O projeto reúne uma loja pública, autenticação com Discord, carteira virtual, pagamentos via Mercado Pago e recursos operacionais para a equipe administrar pedidos e entregas.

## Visão do projeto

O objetivo é centralizar a jornada do jogador: visualizar produtos, entrar com a conta Discord, concluir a compra e acompanhar o processamento da entrega — enquanto a equipe utiliza um painel interno para operar a plataforma.

## Principais recursos

- Catálogo público de produtos voltados à comunidade Palworld
- Autenticação e vinculação de usuários via Discord
- Carteira virtual para gerenciamento de moedas do servidor
- Checkout integrado ao Mercado Pago
- Webhook para validar pagamentos, creditar moedas e iniciar a fila de entrega
- Painel administrativo para a equipe gerenciar a operação

## Tecnologias

- **Frontend:** HTML, CSS e JavaScript
- **Backend:** funções serverless na Vercel
- **Banco de dados e autenticação:** Supabase
- **Integrações:** Discord OAuth e Mercado Pago

## Estrutura do repositório

| Caminho | Responsabilidade |
| --- | --- |
| `index.html` | Loja pública, login Discord, carteira e catálogo |
| `admin.html` | Painel de operação da equipe |
| `api/checkout.js` | Criação de preferências de pagamento no Mercado Pago |
| `api/webhook.js` | Validação do pagamento, crédito de moedas e criação da fila de entrega |

## Configuração

Use o arquivo `.env.example` como referência para configurar as variáveis de ambiente na Vercel.

> Chaves de serviço, tokens de pagamento e segredos de webhook nunca devem ser expostos no frontend ou versionados no repositório.

## Integração com Discord

O provedor Discord deve estar habilitado no Supabase. Após configurar o domínio da aplicação, inclua-o nas URLs de redirecionamento da autenticação.

---

Projeto desenvolvido para integrar experiência do jogador, pagamentos e operação de uma comunidade de games em uma única plataforma.
