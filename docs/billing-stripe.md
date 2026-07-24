# Configuração do Billing (Stripe)

Guia de configuração da cobrança por assinatura do CRM ProgrameAi.

> **Quando isto se aplica:** apenas à **instância SaaS hospedada** pelo mantenedor.
> Quem **autohospeda** não precisa configurar nada aqui — deixe `BILLING_ENABLED=false`
> (o padrão) e o CRM roda 100% liberado, sem nunca inicializar o Stripe.

Modelo: **R$ 27,97/mês** por owner, com **14 dias de trial** concedidos no cadastro.
Expirado o trial sem assinatura ativa, o acesso ao CRM é bloqueado (HTTP `402`) —
restam liberadas apenas as rotas de billing e as rotas públicas (login/logout).
A cobrança em si é 100% delegada ao Stripe (Checkout + Customer Portal + Webhooks);
**não** armazenamos dados de cartão.

---

## Visão geral do que configurar

1. Criar a conta/produto/preço no **dashboard do Stripe**.
2. Configurar o **endpoint de webhook** no Stripe apontando para a API.
3. Preencher **4 variáveis de ambiente** na API (`apps/api/.env`).
4. (Só em dev) usar o **Stripe CLI** para encaminhar webhooks ao `localhost`.

Nenhuma configuração é necessária no frontend: ele descobre se o billing está
ligado consultando `GET /billing/status` (campo `billingEnabled`) e esconde toda
a UI de billing quando desligado.

---

## 1. Dashboard do Stripe

Acesse o [dashboard do Stripe](https://dashboard.stripe.com). Use **test mode**
(chave `sk_test_…`) em dev/staging e **live mode** (`sk_live_…`) só em produção.
As chaves, o produto e o webhook são **separados por modo** — configure cada um no
modo correto.

### 1.1. Produto e preço

1. **Products → Add product**.
2. Nome: ex. `CRM ProgrameAi`.
3. Em **Pricing**:
   - Modelo: **Recurring** (recorrente).
   - Valor: **R$ 27,97**, moeda **BRL**.
   - Período de cobrança: **Monthly** (mensal).
4. Salve e copie o **Price ID** (formato `price_…`). É ele que vai em
   `STRIPE_PRICE_ID` — **não** use o Product ID (`prod_…`).

> **Um único preço.** O produto tem só um `STRIPE_PRICE_ID`. Não há múltiplos
> planos/tiers.

### 1.2. Chave secreta da API

**Developers → API keys → Secret key**. Copie a **Secret key** (`sk_test_…` ou
`sk_live_…`). Vai em `STRIPE_SECRET_KEY`.

> ⚠️ A **secret key** é sigilosa — nunca commite no repositório. Gerencie-a fora
> do versionamento (variável de ambiente do provedor / gerenciador de segredos).

### 1.3. Endpoint de webhook

**Developers → Webhooks → Add endpoint**.

- **Endpoint URL:** `https://SEU_DOMINIO/api/v1/billing/webhook`
  (em dev, veja a seção 4 — use o Stripe CLI em vez de um endpoint público).
- **Eventos a escutar** (selecione exatamente estes):
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Após criar, copie o **Signing secret** (`whsec_…`). Vai em
  `STRIPE_WEBHOOK_SECRET`.

> O signing secret é **por endpoint** — cada ambiente (dev via CLI, staging,
> produção) tem o seu. Use o correspondente ao ambiente.

### 1.4. Customer Portal

**Settings → Billing → Customer portal** e clique em **Activate** (ou salve as
configurações). O portal é o que abre no botão "Gerenciar assinatura" (permite ao
cliente trocar cartão, ver faturas e cancelar). Sem ativá-lo, `POST /billing/portal`
falha no Stripe.

---

## 2. Variáveis de ambiente da API

Em `apps/api/.env` (ver `apps/api/.env.example`):

```dotenv
# Liga o gate de assinatura. Só na instância hospedada.
BILLING_ENABLED=true
# Secret key da API (test: sk_test_… / produção: sk_live_…)
STRIPE_SECRET_KEY="sk_test_..."
# Signing secret do endpoint de webhook (por endpoint/ambiente)
STRIPE_WEBHOOK_SECRET="whsec_..."
# Price ID do preço recorrente de R$ 27,97/mês (NÃO o Product ID)
STRIPE_PRICE_ID="price_..."
```

Regras importantes:

- **`BILLING_ENABLED=true` só liga o gate se `STRIPE_SECRET_KEY` também estiver
  presente.** Se ligar sem a chave, a API sobe com um `warn` no log e o billing
  fica inativo (comportamento seguro).
- Com `BILLING_ENABLED=false` (ou ausente), nada de Stripe é inicializado e todas
  as rotas do CRM ficam liberadas — é o modo de **autohospedagem**.
- O redirect de sucesso/cancelamento do Checkout e o retorno do Portal usam a
  `FRONTEND_URL` já existente no `.env` (ex.: `https://app.seudominio.com`).
  Garanta que ela aponte para o frontend correto do ambiente.

Depois de editar o `.env`, **reinicie a API** para recarregar a configuração.

---

## 3. Como validar (test mode)

1. Suba o banco e a API:
   ```bash
   docker compose up -d
   pnpm --filter api start:dev
   ```
2. Suba o frontend:
   ```bash
   pnpm --filter web dev
   ```
3. Encaminhe os webhooks do Stripe para o `localhost` (ver seção 4).
4. No app: crie uma conta nova → você entra em **trial de 14 dias** (banner no topo).
5. Vá em **menu do usuário → Assinatura** → **Assinar** → complete o Checkout de
   teste com o cartão `4242 4242 4242 4242`, qualquer validade futura e qualquer CVC.
6. O webhook `checkout.session.completed`/`customer.subscription.*` deve marcar a
   assinatura como **ativa** — o acesso permanece liberado.
7. Para testar o bloqueio: no banco, coloque `trialEndsAt` no passado (sem
   assinatura ativa) e navegue no CRM → você é redirecionado ao **paywall** (`/assinatura`).

---

## 4. Stripe CLI (encaminhar webhooks em dev)

Em dev o Stripe não alcança seu `localhost`. Use o
[Stripe CLI](https://docs.stripe.com/stripe-cli):

```bash
# 1. Autenticar (uma vez)
stripe login

# 2. Encaminhar os eventos para a API local
stripe listen --forward-to localhost:3000/api/v1/billing/webhook
```

O `stripe listen` imprime um **signing secret temporário** (`whsec_…`) — use-o em
`STRIPE_WEBHOOK_SECRET` no `.env` **enquanto** estiver rodando o CLI (é diferente do
secret do endpoint de produção).

Para disparar eventos manualmente e testar a sincronização:

```bash
stripe trigger checkout.session.completed
stripe trigger customer.subscription.deleted
```

---

## Referência rápida das variáveis

| Variável | Onde obter | Exemplo | Obrigatória p/ billing |
|---|---|---|---|
| `BILLING_ENABLED` | você define | `true` | sim (liga o gate) |
| `STRIPE_SECRET_KEY` | Developers → API keys | `sk_test_…` / `sk_live_…` | sim |
| `STRIPE_WEBHOOK_SECRET` | Webhook endpoint (ou `stripe listen`) | `whsec_…` | sim (para o webhook) |
| `STRIPE_PRICE_ID` | Products → seu preço recorrente | `price_…` | sim |
| `FRONTEND_URL` | já existente | `https://app.seudominio.com` | sim (redirects) |

---

## Rotas envolvidas

Documentadas em `apps/api/ENDPOINTS.md` (seção **Billing (Stripe)**):

- `POST /billing/checkout` — inicia o Checkout (retorna a URL do Stripe).
- `POST /billing/portal` — abre o Customer Portal.
- `GET /billing/status` — status da assinatura do owner (+ `billingEnabled`).
- `POST /billing/webhook` — consumido pelo Stripe (público, assinatura verificada).

## Solução de problemas

- **`400 Assinatura do webhook inválida.`** → `STRIPE_WEBHOOK_SECRET` não bate com
  o endpoint/CLI atual, ou o corpo foi alterado por algum proxy. Em dev, use o
  secret que o `stripe listen` imprimiu.
- **`503 Cobrança não está habilitada nesta instância.`** no checkout/portal →
  `BILLING_ENABLED` não é `true` ou `STRIPE_SECRET_KEY` está vazia. Confira o `.env`
  e reinicie a API.
- **`POST /billing/portal` falha no Stripe** → o **Customer Portal** não foi ativado
  no dashboard (seção 1.4).
- **Checkout abre mas nada muda no CRM** → o webhook não está chegando. Confira o
  `stripe listen` (dev) ou o endpoint/eventos no dashboard (produção).
- **Assinei mas continuo bloqueado** → verifique se o evento `customer.subscription.*`
  marcou o status como `ACTIVE` na tabela `Subscription` do owner.
