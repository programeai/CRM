---
date: 2026-07-24T00:00:00-03:00
author: claude
source_prd: standalone
git_commit: 5c0b82a2ec57c27e3ba9ca35eb84121a95494139
branch: main
status: approved
tags: [spec, billing, stripe, subscription, nestjs, rls]
---

# Spec: Módulo de Billing com Stripe (SaaS hospedado)

## Overview

Implementar cobrança por assinatura recorrente (**R$ 27,97/mês**) via Stripe, ativa **apenas na instância SaaS hospedada pelo owner**. Quem autohospeda não configura Stripe e roda o CRM 100% livre — o billing é controlado por uma flag `BILLING_ENABLED` e pela presença das chaves Stripe. O mesmo código-base serve os dois cenários; o comportamento é decidido por configuração.

Modelo escolhido: **multi-owner numa única instância**. O CRM já tem isolamento por `ownerId` via RLS (cada `User.id` é um owner isolado). Cada usuário cadastrado na instância SaaS é um owner que paga a própria assinatura. Ao se cadastrar, o owner recebe **14 dias de trial**; expirado sem assinatura ativa, o acesso às rotas do CRM é bloqueado — restam liberadas apenas as rotas de billing e as rotas públicas (login/logout).

A cobrança em si é delegada ao Stripe (Checkout + Customer Portal + webhooks). Não armazenamos dados de cartão. O estado local (`Subscription`) é um espelho, sincronizado pelos webhooks, usado só para o gate de acesso.

## Current State

- NestJS monólito modular; módulos em `apps/api/src/modules/<nome>/` com camadas `domain/application/infra/api` e DI por token `Symbol` (padrão em `finance.module.ts`).
- Config via `@nestjs/config` + validação Joi (`apps/api/src/config/env.validation.ts`).
- `JwtAuthGuard` **global** (`app.module.ts` via `APP_GUARD`); rotas públicas marcadas `@Public()` (`public.decorator.ts`); owner do request em `@CurrentUserId()` (`shared/current-user.decorator.ts`) = `req.user.sub`.
- RLS por `ownerId`: `PrismaService` (role `crm_app`, sujeito a RLS, getter `prisma.db`) vs `PrismaAdminService` (role `crm_user`, bypassa RLS — para crons/seed). Template de policy em `prisma/migrations/20260724050000_enable_rls/migration.sql`.
- `User` (`schema.prisma:13-22`) está **fora** do RLS; **não** tem `stripeCustomerId`. Não há modelo de assinatura SaaS (os modelos `Contract`/`Payment` existentes são financeiro-de-clientes do CRM, não billing).
- **Não** há webhook nem `rawBody` hoje; `main.ts` usa `NestFactory.create(AppModule)` com body parser JSON default e `ValidationPipe` global.
- Sem `ExceptionFilter` global; exceções lançadas direto com classes do `@nestjs/common`, mensagens **em pt-BR** (obrigatório). Todo endpoint deve ser refletido em `apps/api/ENDPOINTS.md`.

## Desired End State

- Modelo `Subscription` (1 por owner) + `stripeCustomerId` no `User`, com migration e — para `Subscription` — bloco RLS por `ownerId`.
- `BillingModule` (camadas `domain/application/infra/api`) com: criar sessão de Checkout, abrir Customer Portal, consultar status da assinatura do owner atual.
- Webhook Stripe (`@Public`, assinatura verificada, `rawBody`) que sincroniza `Subscription` a partir dos eventos, usando `PrismaAdminService` (sem contexto de owner).
- `BillingGuard` global (após o `JwtAuthGuard`) que, quando `BILLING_ENABLED=true`, bloqueia owners sem trial/assinatura ativa — liberando `@Public()` e as rotas de billing.
- Trial de 14 dias concedido no cadastro.
- Frontend: estado de billing, tela de paywall/assinatura, e CTA de upgrade quando bloqueado.
- Com `BILLING_ENABLED` ausente/false (autohospedagem): tudo liberado, Stripe nunca inicializado.

## What We're NOT Doing

- **Sem cobrar autohospedagem** — o gate só liga com `BILLING_ENABLED=true` + chaves Stripe presentes.
- **Sem multi-tenancy/organizações** — mantém-se single-tenant multi-owner; cada `User` é um owner (respeita `CLAUDE.md`).
- **Sem múltiplos planos/tiers** — um único preço (R$ 27,97/mês). O `STRIPE_PRICE_ID` aponta para um preço só.
- **Sem armazenar dados de cartão** nem reimplementar tela de pagamento — usa Stripe Checkout/Portal hospedados.
- **Sem faturas/NF-e locais** — a gestão fica no Stripe.
- **Sem mexer no financeiro-de-clientes** (`Contract`/`Payment`) — domínio distinto.
- **Sem enforcement por método (read-only)** — o gate bloqueia o acesso inteiro após o trial (decisão de produto).

---

## Phase 1: Dados & configuração

### Goal
Ter o modelo de assinatura, as variáveis de ambiente Stripe e um `StripeService` que só inicializa quando configurado — sem ainda expor rotas.

### Changes

#### Schema Prisma

**Modify**: `apps/api/prisma/schema.prisma` (modelo `User`, ~linha 13-22)
Adicionar o id de cliente Stripe (fica no `User`, que está fora do RLS — acessível pelo webhook).
```prisma
model User {
  // ...campos existentes...
  stripeCustomerId String?       @unique
  subscription     Subscription?
}
```

**Modify**: `apps/api/prisma/schema.prisma` (novo modelo + enum)
```prisma
model Subscription {
  id                   String             @id @default(uuid())
  ownerId              String             @unique
  owner                User               @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  stripeSubscriptionId String?            @unique
  status               SubscriptionStatus @default(TRIALING)
  trialEndsAt          DateTime?
  currentPeriodEnd     DateTime?
  cancelAtPeriodEnd    Boolean            @default(false)
  createdAt            DateTime           @default(now())
  updatedAt            DateTime           @updatedAt
}

enum SubscriptionStatus {
  TRIALING
  ACTIVE
  PAST_DUE
  CANCELED
  INCOMPLETE
}
```
> `ownerId` referencia `User.id`. `owner @relation` liga ao `User`. Como `User` está fora do RLS, o `@relation` é seguro; o RLS incide sobre a tabela `Subscription` (ver migration abaixo).

**Create**: `apps/api/prisma/migrations/<timestamp>_add_subscription/migration.sql`
Gerada por `prisma migrate dev --name add_subscription`. **Após** gerar, acrescentar manualmente ao final o bloco RLS por `ownerId`, replicando o template de `20260724050000_enable_rls/migration.sql`:
```sql
ALTER TABLE "Subscription" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Subscription" FORCE ROW LEVEL SECURITY;
CREATE POLICY "owner_isolation" ON "Subscription"
  USING ("ownerId" = current_setting('app.owner_id', true))
  WITH CHECK ("ownerId" = current_setting('app.owner_id', true));
GRANT SELECT, INSERT, UPDATE, DELETE ON "Subscription" TO crm_app;
```
> Copiar os nomes/cláusulas exatos do arquivo `enable_rls` para não divergir (inclusive `GRANT` ao role `crm_app`, se presente lá). `User` **não** ganha RLS (permanece fora).

#### Configuração de ambiente

**Modify**: `apps/api/src/config/env.validation.ts` (dentro do `Joi.object({...})`)
Adicionar as variáveis, todas opcionais (autohospedagem não as define), seguindo o padrão `.allow('').default('')`.
```typescript
BILLING_ENABLED: Joi.boolean().default(false),
STRIPE_SECRET_KEY: Joi.string().allow('').default(''),
STRIPE_WEBHOOK_SECRET: Joi.string().allow('').default(''),
STRIPE_PRICE_ID: Joi.string().allow('').default(''),
```

**Modify**: `apps/api/.env.example`
Documentar as novas variáveis em pt-BR, deixando claro que são só para a instância hospedada.
```dotenv
# Billing (Stripe) — deixe BILLING_ENABLED=false na autohospedagem.
# Preenchido apenas na instância SaaS hospedada pelo mantenedor.
BILLING_ENABLED=false
STRIPE_SECRET_KEY=""
STRIPE_WEBHOOK_SECRET=""
STRIPE_PRICE_ID=""
```

#### Dependência e serviço Stripe

**Create**: dependência — rodar `pnpm --filter api add stripe`.

**Create**: `apps/api/src/modules/billing/application/stripe.service.ts`
Wrapper do SDK. Só instancia o client se `STRIPE_SECRET_KEY` existir; expõe `isEnabled()` e o client.
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const billingEnabled = this.config.get<boolean>('BILLING_ENABLED') ?? false;
    this.enabled = billingEnabled && key.length > 0;
    this.stripe = this.enabled ? new Stripe(key) : null;
    if (billingEnabled && !this.enabled) {
      this.logger.warn('BILLING_ENABLED=true mas STRIPE_SECRET_KEY ausente — billing inativo.');
    }
  }

  get client(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe não configurado nesta instância.');
    }
    return this.stripe;
  }
}
```

**Create**: `apps/api/src/modules/billing/billing.module.ts`
Módulo inicial só com `StripeService` (controllers/repos entram nas próximas fases). Exporta `StripeService` e o (futuro) service de status para o guard.
```typescript
import { Module } from '@nestjs/common';
import { StripeService } from './application/stripe.service';

@Module({
  providers: [StripeService],
  exports: [StripeService],
})
export class BillingModule {}
```

**Modify**: `apps/api/src/app.module.ts` (lista de imports, ~linha 31-39)
Adicionar `BillingModule`.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api prisma migrate dev --name add_subscription` — aplica a migration
- [ ] `pnpm --filter api prisma validate` — schema válido
- [ ] `pnpm --filter api build` — compila com o `StripeService` e o `stripe` instalado
- [ ] `grep -q "Subscription" apps/api/prisma/schema.prisma`

#### Manual Verification
- [ ] Com `BILLING_ENABLED=false`, subir a API não instancia Stripe e não emite erro
- [ ] Tabela `Subscription` criada com RLS habilitado (`\d+ "Subscription"` mostra policy `owner_isolation`)

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 2.

---

## Phase 2: Módulo de billing (checkout, portal, status)

### Goal
Expor as rotas autenticadas que o owner usa para assinar e gerenciar: criar sessão de Checkout, abrir o Customer Portal e consultar o próprio status.

### Changes

#### Domain

**Create**: `apps/api/src/modules/billing/domain/subscription.repository.ts`
Interface + token DI (padrão `payment.repository.ts`).
```typescript
export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

export interface SubscriptionSnapshot {
  status: 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

export interface SubscriptionRepository {
  findByOwnerId(ownerId: string): Promise<SubscriptionSnapshot | null>;
  // usados pelo webhook (Phase 3), via repositório admin:
  upsertByStripeCustomerId(stripeCustomerId: string, data: Partial<SubscriptionSnapshot> & { stripeSubscriptionId?: string }): Promise<void>;
  getUserStripeCustomerId(ownerId: string): Promise<string | null>;
  setUserStripeCustomerId(ownerId: string, stripeCustomerId: string): Promise<void>;
}
```

#### Infra

**Create**: `apps/api/src/modules/billing/infra/prisma-subscription.repository.ts`
Implementa a interface. Leituras/escritas do owner atual via `prisma.db` (RLS); as operações do webhook via `PrismaAdminService` (sem owner no contexto) — método dedicado. Espelhar `prisma-payment.repository.ts` na injeção de `PrismaService` + `PrismaAdminService`.
```typescript
@Injectable()
export class PrismaSubscriptionRepository implements SubscriptionRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}
  // findByOwnerId / getUserStripeCustomerId / setUserStripeCustomerId → this.prisma.db
  // upsertByStripeCustomerId → this.admin (bypass RLS; resolve ownerId via User.stripeCustomerId)
}
```
> `User` está fora do RLS, então `getUserStripeCustomerId`/`setUserStripeCustomerId` funcionam mesmo sem policy. `Subscription` tem RLS: no caminho HTTP o `OwnerContextInterceptor` já setou `app.owner_id`, então `prisma.db` enxerga só a linha do owner.

#### Application

**Create**: `apps/api/src/modules/billing/application/billing.service.ts`
Regras de negócio. Injeta `StripeService` e `SUBSCRIPTION_REPOSITORY`. Métodos:
- `createCheckoutSession(ownerId, email)`: garante `stripeCustomerId` (cria customer no Stripe se faltar, persiste), cria `checkout.sessions` no modo `subscription` com `STRIPE_PRICE_ID`, `success_url`/`cancel_url` (base em `FRONTEND_URL`), retorna a URL.
- `createPortalSession(ownerId)`: cria `billingPortal.sessions` para o `stripeCustomerId`, retorna a URL. Lança `NotFoundException('Assinatura não encontrada.')` se não houver customer.
- `getStatus(ownerId)`: retorna o `SubscriptionSnapshot` (ou um default TRIALING computado do `trialEndsAt`) para o frontend.
- Todas as mensagens de erro em **pt-BR**.

**Create**: `apps/api/src/modules/billing/application/subscription-access.service.ts`
Fonte única de verdade do gate (consumida pelo `BillingGuard` na Phase 4). Método `hasAccess(ownerId): Promise<boolean>` — `true` se `status ∈ {TRIALING, ACTIVE}` **e** (se TRIALING) `trialEndsAt > now`, ou se `currentPeriodEnd > now` para ACTIVE/PAST_DUE em grace. Regra exata:
```typescript
// TRIALING: acesso enquanto trialEndsAt > agora
// ACTIVE: acesso enquanto currentPeriodEnd > agora (ou sem data → confia no status)
// PAST_DUE: acesso em grace até currentPeriodEnd; depois bloqueia
// CANCELED / INCOMPLETE: sem acesso
```
> Sem `Date.now()` proibido aqui — código de aplicação normal usa `new Date()` livremente (a proibição é só em scripts de workflow). Usar `new Date()`.

#### API

**Create**: `apps/api/src/modules/billing/api/billing.controller.ts`
`@Controller('billing')`. Rotas autenticadas (guard global cobre), owner via `@CurrentUserId()`:
- `POST /billing/checkout` → `{ url }`
- `POST /billing/portal` → `{ url }`
- `GET /billing/status` → `SubscriptionSnapshot`
> Se `StripeService.enabled === false`, retornar `ServiceUnavailableException('Cobrança não está habilitada nesta instância.')` em checkout/portal. Estas rotas devem ficar **isentas** do `BillingGuard` (Phase 4) — senão um owner bloqueado não consegue assinar.

**Modify**: `apps/api/src/modules/billing/billing.module.ts`
Registrar controller, services e o binding `{ provide: SUBSCRIPTION_REPOSITORY, useClass: PrismaSubscriptionRepository }`. Exportar `SubscriptionAccessService` e `StripeService` (para o guard global na Phase 4).

**Modify**: `apps/api/ENDPOINTS.md`
Documentar `POST /billing/checkout`, `POST /billing/portal`, `GET /billing/status` (regra do CLAUDE.md — mesmo commit).

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api build` — compila
- [ ] `pnpm --filter api lint` — sem erros (se houver script lint)
- [ ] `grep -q "/billing/checkout" apps/api/ENDPOINTS.md`

#### Manual Verification
- [ ] Com Stripe de teste configurado, `POST /billing/checkout` retorna URL de Checkout válida
- [ ] Completar o Checkout de teste cria um customer no dashboard Stripe
- [ ] `POST /billing/portal` retorna URL do portal para um owner com customer
- [ ] `GET /billing/status` retorna o estado do owner atual (isolado por RLS)

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 3.

---

## Phase 3: Webhook Stripe (sincronização)

### Goal
Manter o `Subscription` local em sincronia com o Stripe, reagindo aos eventos de assinatura — de forma segura (assinatura verificada) e sem contexto de owner.

### Changes

#### Habilitar raw body

**Modify**: `apps/api/src/main.ts` (linha ~8)
```typescript
const app = await NestFactory.create(AppModule, { rawBody: true });
```
> `rawBody: true` mantém o parser JSON para as demais rotas e disponibiliza `req.rawBody` (Buffer) — necessário para `stripe.webhooks.constructEvent`. O `ValidationPipe` global não interfere pois o handler do webhook não usa DTO.

#### Controller do webhook

**Create**: `apps/api/src/modules/billing/api/stripe-webhook.controller.ts`
`@Controller('billing')`, rota `@Post('webhook')` marcada **`@Public()`** (sem JWT). Lê `req.rawBody` e o header `stripe-signature`, valida com `STRIPE_WEBHOOK_SECRET` via `stripe.webhooks.constructEvent`. Em assinatura inválida → `BadRequestException('Assinatura do webhook inválida.')`.
```typescript
@Public()
@Post('webhook')
async handle(@Req() req: RawBodyRequest<Request>, @Headers('stripe-signature') sig: string) {
  const event = this.stripe.client.webhooks.constructEvent(
    req.rawBody!, sig, this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
  );
  await this.billingWebhookService.process(event);
  return { received: true };
}
```
> Como é `@Public()`, o `OwnerContextInterceptor` não abre transação de owner — o service usa `PrismaAdminService` (bypass RLS), resolvendo o owner pelo `stripeCustomerId` do evento.

#### Service de processamento

**Create**: `apps/api/src/modules/billing/application/billing-webhook.service.ts`
Trata os eventos relevantes e faz upsert via `SUBSCRIPTION_REPOSITORY.upsertByStripeCustomerId` (caminho admin):
- `checkout.session.completed` → vincular `stripeSubscriptionId`/`stripeCustomerId`, status conforme sub.
- `customer.subscription.created|updated` → mapear `status` do Stripe → `SubscriptionStatus` local, gravar `currentPeriodEnd`, `cancelAtPeriodEnd`, `trialEndsAt`.
- `customer.subscription.deleted` → `status = CANCELED`.
- Idempotência: upsert por `stripeCustomerId`/`stripeSubscriptionId`; eventos repetidos são seguros.
- Eventos não tratados → ignorar (log debug), responder 200.

**Modify**: `apps/api/src/modules/billing/billing.module.ts`
Registrar `StripeWebhookController` e `BillingWebhookService`.

**Modify**: `apps/api/ENDPOINTS.md`
Documentar `POST /billing/webhook` (público, consumido pelo Stripe).

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api build` — compila com `RawBodyRequest`/`rawBody`
- [ ] `grep -q "rawBody: true" apps/api/src/main.ts`
- [ ] `grep -q "/billing/webhook" apps/api/ENDPOINTS.md`

#### Manual Verification
- [ ] `stripe listen --forward-to localhost:3000/api/v1/billing/webhook` + `stripe trigger checkout.session.completed` → linha em `Subscription` atualizada
- [ ] Assinatura inválida (payload adulterado) → `400` com mensagem pt-BR
- [ ] `customer.subscription.deleted` → `status = CANCELED` no banco
- [ ] Demais rotas (JSON) continuam funcionando com `rawBody: true` ligado

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 4.

---

## Phase 4: Enforcement de acesso (guard + trial)

### Goal
Bloquear owners sem trial/assinatura ativa **apenas quando o billing está habilitado**, concedendo trial no cadastro. Autohospedagem (billing off) permanece totalmente liberada.

### Changes

#### Trial no cadastro

**Modify**: registro de usuário (localizar em `apps/api/src/modules/auth/` — o fluxo de signup/registro)
Ao criar o `User`, criar também o `Subscription` com `status = TRIALING` e `trialEndsAt = agora + 14 dias`. Fazer na mesma transação da criação do usuário.
```typescript
// após criar o User:
trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
// criar Subscription { ownerId: user.id, status: TRIALING, trialEndsAt }
```
> Confirmar o arquivo/serviço exato do registro (provavelmente `auth.service.ts` ou um `register`/`signup`). Como `Subscription` tem RLS e o cadastro ainda não tem contexto de owner setado, criar via `PrismaAdminService` **ou** dentro de um bloco que sete `app.owner_id = user.id`. Escolher o caminho consistente com como o registro grava hoje (verificar se usa admin).

#### Guard global de billing

**Create**: `apps/api/src/modules/billing/billing.guard.ts`
Guard que roda **depois** do `JwtAuthGuard`. Lógica:
1. Se `StripeService.enabled === false` → `return true` (autohospedagem / billing off).
2. Se rota é `@Public()` (ler metadata `IS_PUBLIC_KEY` via `Reflector`, igual ao `jwt-auth.guard.ts`) → `return true`.
3. Se rota pertence ao próprio billing (checkout/portal/status/webhook) → `return true` (senão o bloqueado não consegue pagar). Marcar essas rotas com um decorator dedicado `@AllowWithoutSubscription()` ou checar o path `billing`.
4. Caso contrário: `ownerId = req.user.sub`; se `SubscriptionAccessService.hasAccess(ownerId)` for `false` → `throw new PaymentRequiredException(...)`.
```typescript
// 402 é o status semântico; Nest não tem classe pronta → usar HttpException:
throw new HttpException(
  'Sua assinatura expirou. Ative um plano para continuar usando o CRM.',
  HttpStatus.PAYMENT_REQUIRED, // 402
);
```

**Create**: `apps/api/src/modules/billing/allow-without-subscription.decorator.ts`
Decorator de metadata (padrão `public.decorator.ts`) para marcar rotas isentas do gate (as três rotas de billing e o webhook). O guard lê via `reflector.getAllAndOverride`.

**Modify**: `apps/api/src/modules/billing/api/billing.controller.ts` e `stripe-webhook.controller.ts`
Anotar as rotas com `@AllowWithoutSubscription()`.

**Modify**: `apps/api/src/app.module.ts` (providers, ~linha 41-45)
Registrar o `BillingGuard` como `APP_GUARD` **após** o `JwtAuthGuard` (ordem importa: precisa de `req.user`).
```typescript
{ provide: APP_GUARD, useClass: JwtAuthGuard },
{ provide: APP_GUARD, useClass: BillingGuard },
```
> Guards `APP_GUARD` executam na ordem de registro. `BillingGuard` depende de `SubscriptionAccessService` e `StripeService` — garantir que `BillingModule` os exporte e que o guard consiga injetá-los (guards globais via `APP_GUARD` participam da DI).

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api build` — compila
- [ ] `pnpm --filter api test` — suíte existente continua verde (se houver)

#### Manual Verification
- [ ] `BILLING_ENABLED=false`: qualquer rota do CRM responde normalmente (sem gate)
- [ ] `BILLING_ENABLED=true`, owner em trial válido: acesso normal
- [ ] Trial expirado (ajustar `trialEndsAt` no banco para o passado): rota do CRM → `402` com mensagem pt-BR; `GET /billing/status` e `POST /billing/checkout` ainda respondem
- [ ] Após assinar (webhook → `ACTIVE`): acesso volta a ser liberado
- [ ] Novo cadastro cria `Subscription` TRIALING com `trialEndsAt` ≈ +14 dias

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 5.

---

## Phase 5: Frontend (paywall e tela de assinatura)

### Goal
Dar ao owner uma experiência clara: ver status da assinatura, assinar/gerenciar, e um paywall quando bloqueado. Tudo condicional ao billing estar ativo.

### Changes

> Seguir os padrões de `apps/web` (features/lib, labels pt-BR, cor de marca teal `#0E7C7B`). Confirmar o client HTTP e o padrão de data-fetching usados (React Query? fetch wrapper em `lib`?) antes de codar.

#### Camada de dados

**Create**: `apps/web/src/features/billing/api.ts`
Funções que chamam a API: `getBillingStatus()` → `GET /billing/status`; `startCheckout()` → `POST /billing/checkout` e redireciona para a `url`; `openPortal()` → `POST /billing/portal` e redireciona.

**Create**: `apps/web/src/features/billing/useSubscription.ts`
Hook que carrega o status e expõe `{ status, trialEndsAt, isBlocked, daysLeftInTrial }`. `isBlocked` = status expirado (espelha a regra do backend, mas o backend é a autoridade — o 402 é o gate real).

#### Interceptação do 402

**Modify**: cliente HTTP do web (localizar o wrapper em `apps/web/src/lib/` — provável `api.ts`/`http.ts`)
Ao receber `402`, redirecionar para a rota de paywall (`/assinatura` ou modal), em vez de tratar como erro genérico.

#### Telas

**Create**: `apps/web/src/features/billing/PaywallPage.tsx`
Tela exibida quando bloqueado: explica que o trial acabou, mostra o preço **R$ 27,97/mês**, botão "Assinar" (→ `startCheckout`). Copy em pt-BR, identidade ProgrameAi.

**Create**: `apps/web/src/features/billing/SubscriptionSettings.tsx`
Em configurações: mostra status atual (trial com dias restantes / ativa / cancelada), botão "Gerenciar assinatura" (→ `openPortal`) e, se sem assinatura, "Assinar".

**Modify**: roteamento (`apps/web/src/app/` — onde as rotas são declaradas)
Registrar a rota de paywall e o item de "Assinatura" nas configurações. Exibir o aviso de trial (banner com dias restantes) só quando o billing estiver ativo — o `GET /billing/status` só é chamado nesse caso; em autohospedagem a rota pode 200 com um status neutro ou o frontend simplesmente não monta a feature. Definir: **o frontend consulta `/billing/status` e, se a resposta indicar billing desabilitado, esconde toda a UI de billing.**

> Para o front saber se o billing está ligado sem heurística: incluir no `GET /billing/status` um campo `billingEnabled: boolean` (refletindo `StripeService.enabled`). Ajustar o DTO de status na Phase 2 se possível, ou aditar aqui.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter web build` — compila
- [ ] `pnpm --filter web lint` — sem erros (se houver)

#### Manual Verification
- [ ] Billing off: nenhuma UI de billing aparece; app funciona igual a hoje
- [ ] Billing on, trial: banner com dias restantes; tela de assinatura mostra "Assinar"
- [ ] Clicar "Assinar" leva ao Checkout do Stripe e, ao concluir, volta ativo
- [ ] Trial expirado: ao navegar, o 402 redireciona ao paywall; assinar restaura o acesso
- [ ] "Gerenciar assinatura" abre o Customer Portal

**⏸ PAUSE**: Confirmação humana final.

---

## Testing Strategy

### Unit Tests
- `SubscriptionAccessService.hasAccess`: cobrir TRIALING válido/expirado, ACTIVE com/sem `currentPeriodEnd`, PAST_DUE em grace vs expirado, CANCELED, INCOMPLETE.
- `BillingWebhookService.process`: mapeamento de cada `status` do Stripe → `SubscriptionStatus` local; idempotência de evento repetido.
- `StripeService`: `enabled` false quando falta chave / billing off; `client` lança quando desabilitado.

### Integration Tests
- Fluxo e2e com Stripe test mode + `stripe listen`: cadastro → trial → expirar → 402 → checkout → webhook `ACTIVE` → acesso liberado → portal → cancelar → `CANCELED` → 402.
- Isolamento: dois owners na mesma instância enxergam apenas a própria `Subscription` (RLS).

### Migration & Rollback
- Migration `add_subscription` é aditiva (nova tabela + coluna nullable) — segura. Rollback: `prisma migrate resolve`/reverter, dropar tabela e coluna.
- Feature desligável a quente: `BILLING_ENABLED=false` neutraliza guard, rotas e UI sem reverter código.

## Environment Considerations
- **CI/CD**: se houver pipeline de teste, os novos testes unitários entram nela. Testes de webhook exigem Stripe CLI — manter como manual/opcional.
- **Migrations**: `add_subscription` + edição manual do SQL para RLS (não esquecer o bloco após `prisma migrate`).
- **Config/Secrets**: `BILLING_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`. Só na instância hospedada. Criar o produto/preço (R$ 27,97/mês recorrente) no dashboard Stripe e configurar o endpoint de webhook para `…/api/v1/billing/webhook`.
- **Multi-environment**: usar chaves `sk_test_…` em dev/staging e `sk_live_…` só em produção; webhook secret é por endpoint.

## Dependencies & Risks
- **Ordem dos guards**: `BillingGuard` deve rodar após `JwtAuthGuard` (precisa de `req.user`). Registrar na ordem certa em `APP_GUARD`.
- **Rotas isentas**: se as rotas de billing não forem isentas do gate, o owner bloqueado não consegue assinar — deadlock. Cobrir com `@AllowWithoutSubscription()`.
- **Webhook sem contexto de owner**: usar `PrismaAdminService` e resolver owner por `stripeCustomerId`; jamais depender de `app.owner_id` no webhook.
- **rawBody**: confirmar que ligar `rawBody: true` não quebra o parsing das demais rotas (não deveria — o JSON parser continua ativo).
- **Local de criação do trial**: o registro pode não ter contexto de owner setado; escolher admin vs setar `app.owner_id` conforme o padrão atual do signup.
- **Fuso/relógio**: comparações de trial/period usam UTC do servidor; garantir consistência.

## References
- Spec relacionada: `specs/plans/2026-07-24-preparar-open-source.md`
- Padrões de módulo: `apps/api/src/modules/finance/` (module, controller, domain token, infra repo)
- Guard/rotas públicas: `apps/api/src/modules/auth/jwt-auth.guard.ts`, `public.decorator.ts`
- RLS: `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql`
- Prisma dual: `apps/api/src/prisma/prisma.service.ts`, `prisma-admin.service.ts`
- Regras: `CLAUDE.md` (mensagens pt-BR), `apps/api/CLAUDE.md` (camadas, ENDPOINTS.md)
- Stripe: Checkout + Billing (subscriptions) + Customer Portal + Webhooks (test mode via `stripe listen`)
