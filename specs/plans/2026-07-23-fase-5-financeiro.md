---
date: 2026-07-23T17:32:30-03:00
author: claude
source_prd: specs/research/2026-07-23-fase-5-financeiro.md
git_commit: 73e0fea47caa3109749fa355172bfb4b2948d8c7
branch: main
status: implemented
tags: [spec, finance, contracts, payments, cron]
---

# Spec: Fase 5 — Financeiro (Contratos, Cobranças, Agenda, Cron)

## Overview

Implementar o controle de receitas por contrato nos três regimes (`RECURRING`,
`INSTALLMENTS`, `ONE_TIME`), com geração de agenda de cobranças, baixa manual e
estorno, cron diário (gera mensalidade + marca vencidas) e as visões de recebimentos /
contratos / inadimplência.

O modelo de dados (`Contract`, `Payment`, 4 enums) **já existe** no schema e nunca foi
usado por código. A fase é, portanto, construção de um novo módulo NestJS (`finance`,
com dois agregados no molde de `projects` = Project+Task) e de uma nova feature web
(`financeiro`, clonando `propostas` + `demandas`). Reaproveitamos padrões maduros já em
produção: repository pattern com token DI, cálculo monetário em centavos (`money.ts`),
cron diário via `@nestjs/schedule`, transições de status validadas por tabela declarativa
(422), paginação compartilhada, e no frontend a listagem paginada + ficha com ações por
status + a página de lista filtrada não-paginada com realce derivado no client.

A estratégia é backend-primeiro (Fases 1–3, cada uma com specs unitários — é a fase com
"testes de regra críticos"), depois frontend (Fases 4–5), finalizando com a costura
"proposta aceita → sugerir criar contrato" via CTA no frontend.

## Current State

- `apps/api/prisma/schema.prisma:183-225` — `Contract` (sem `@@index`, sem `ownerId`) e
  `Payment` (índices `[contractId,status]`, `[dueDate,status]`). `:302-328` — os 4 enums.
- **Nenhum arquivo em `apps/api/src/` referencia Contract/Payment.**
- `@nestjs/schedule` instalado e `ScheduleModule.forRoot()` registrado (`app.module.ts:24`).
- Frontend pronto: 4 tradutores de enum (`labels.ts:79-109`), grupo de nav "Financeiro"
  (`nav.ts`), 3 rotas placeholder (`router.tsx`).
- **Sem** grupo `contracts`/`payments` em `apps/web/src/lib/query-keys.ts`.

## Desired End State

- Módulo `apps/api/src/modules/finance/` registrado no `AppModule`, expondo:
  - Contratos: `GET/POST /contracts`, `GET/PATCH /contracts/:id`, `POST /contracts/:id/{pause,resume,cancel}`.
  - Cobranças: `GET /payments`, `PATCH /payments/:id`, `POST /payments/:id/{pay,revert,cancel}`.
- Criar contrato `INSTALLMENTS` gera Entrada + N parcelas (soma exata em centavos); `ONE_TIME`
  gera uma cobrança única; `RECURRING` não gera nada na criação.
- Cron diário `EVERY_DAY_AT_3AM`: gera a mensalidade do ciclo 30 dias antes (idempotente por
  `contractId + dueDate`) para contratos `ACTIVE` `RECURRING`; marca `OVERDUE` toda cobrança
  `PENDING` com `dueDate < hoje`.
- Baixa (`pay`) e estorno (`revert`, não-destrutivo) e cancelamento (`cancel`) de cobranças;
  cancelar contrato cancela apenas as cobranças `PENDING`.
- Feature web `financeiro`: `RecebimentosPage` (agenda com filtros + realce de vencido +
  totais), `ContratosListPage`, `ContratoDetalhePage` (ficha + subtabela de cobranças +
  ações), `ContratoFormDialog`. Aba "Contratos" na ficha do cliente populada.
- CTA "Criar contrato" na ficha de proposta `ACCEPTED`, pré-preenchendo cliente/descrição/proposta.
- `ENDPOINTS.md` com seções **Contracts** e **Payments**.

## What We're NOT Doing

- **Criação automática de contrato no `accept`** — decidido: apenas sugestão via CTA no
  frontend (SPEC §3.6 diz "sugere criar contrato"). `ProposalsService.accept` fica inalterado.
- **Endpoint de agregação/summary server-side** — os totais (recebido / a receber / em atraso)
  são calculados no client sobre o conjunto carregado (ficha de contrato = exato pois traz
  todas as cobranças; Recebimentos = totais da seleção filtrada). Um endpoint de summary fica
  para uma fase futura se o volume exigir.
- **Tela dedicada de inadimplência** — inadimplência é filtro (`status=OVERDUE`) + totais por
  cliente dentro da `RecebimentosPage`.
- **Status `FINISHED` (encerrado) via ação** — o enum permanece, mas não há ação `finish` neste
  escopo (ROADMAP pede apenas `pause`/`resume`/`cancel`). Reservado para o futuro.
- **Novo campo de competência no `Payment`** — a dedupe do cron usa `(contractId, dueDate)`
  exato (o `billingDay` é fixo, logo o vencimento é determinístico). Sem migration de coluna.
- **Reprocessar meses perdidos pelo cron** — a geração cobre a janela `(agora, agora+30d]`.
- **Múltiplas parcelas com valores diferentes por regra** — todas as parcelas usam
  `installmentAmount` (o usuário informa o valor da parcela; o form pode sugerir o valor a
  partir de um total, mas isso é conveniência de UI).

---

## Phase 1: Backend — Contratos

### Goal
Criar o `FinanceModule` com o agregado `Contract`: CRUD, `pause`/`resume`/`cancel`, e geração
da agenda de cobranças na criação (`INSTALLMENTS` e `ONE_TIME`).

### Changes

#### Migration

**Create**: `apps/api/prisma/migrations/<AAAAMMDDHHMMSS>_add_contract_indexes/migration.sql`
Adicionar índice em `Contract` (hoje sem nenhum). Editar também `schema.prisma`.
```sql
-- CreateIndex
CREATE INDEX "Contract_clientId_status_idx" ON "Contract"("clientId", "status");
```
**Modify**: `apps/api/prisma/schema.prisma` — adicionar ao final do model `Contract` (após `updatedAt`):
```prisma
  @@index([clientId, status])
```
Gerar via `pnpm --filter api exec prisma migrate dev --name add_contract_indexes` (cria a
migration e regenera o client).

#### Utilitários de domínio

**Create**: `apps/api/src/modules/finance/application/money.ts`
Cópia de `proposals/application/money.ts` (a regra "feature não importa interior de outra"
vale também aqui — copiar, não importar).
```ts
export function toCents(value: number): number { return Math.round(value * 100); }
export function fromCents(cents: number): number { return cents / 100; }
```

**Create**: `apps/api/src/modules/finance/application/schedule.ts`
Funções puras e testáveis (alvo do critério "geração de agenda: soma fecha").
```ts
export interface ScheduledCharge {
  description: string;
  amount: number; // reais, 2 casas (gravado no Decimal)
  dueDate: Date;
}

/** Soma n meses preservando o dia (billingDay é 1–28, então nunca "transborda" o mês). */
export function addMonths(date: Date, n: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + n);
  return d;
}

/**
 * Agenda de INSTALLMENTS: Entrada (se downPayment > 0) + N parcelas iguais.
 * Vencimentos: entrada em downPaymentDueDate; parcela i em firstInstallmentDueDate + (i-1) meses.
 * Soma exata por construção (downPayment + installments × installmentAmount).
 */
export function buildInstallmentSchedule(input: {
  downPayment?: number | null;
  downPaymentDueDate?: Date | null;
  installments: number;
  installmentAmount: number;
  firstInstallmentDueDate: Date;
}): ScheduledCharge[] {
  const charges: ScheduledCharge[] = [];
  if (input.downPayment && input.downPayment > 0) {
    charges.push({
      description: 'Entrada',
      amount: fromCents(toCents(input.downPayment)),
      dueDate: input.downPaymentDueDate ?? input.firstInstallmentDueDate,
    });
  }
  for (let i = 1; i <= input.installments; i++) {
    charges.push({
      description: `Parcela ${i}/${input.installments}`,
      amount: fromCents(toCents(input.installmentAmount)),
      dueDate: addMonths(input.firstInstallmentDueDate, i - 1),
    });
  }
  return charges;
}

/** Agenda de ONE_TIME: cobrança única. */
export function buildOneTimeSchedule(amount: number, dueDate: Date): ScheduledCharge[] {
  return [{ description: 'Pagamento único', amount: fromCents(toCents(amount)), dueDate }];
}

/**
 * Datas de vencimento (billingDay) dentro da janela (from, to], respeitando start/end.
 * Usada pelo cron para descobrir quais mensalidades gerar. Determinística.
 */
export function billingDatesInWindow(
  input: { billingDay: number; startDate: Date; endDate: Date | null },
  from: Date,
  to: Date,
): Date[] {
  const dates: Date[] = [];
  // Varre do mês de `from` até o mês de `to`, montando o dia de cobrança de cada mês.
  const cursor = new Date(from.getFullYear(), from.getMonth(), input.billingDay, 0, 0, 0, 0);
  const limit = new Date(to.getFullYear(), to.getMonth() + 1, 1);
  while (cursor < limit) {
    if (
      cursor > from &&
      cursor <= to &&
      cursor >= input.startDate &&
      (input.endDate == null || cursor <= input.endDate)
    ) {
      dates.push(new Date(cursor));
    }
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return dates;
}
```

#### Domain — Contract repository

**Create**: `apps/api/src/modules/finance/domain/contract.repository.ts`
```ts
import type { Prisma, ContractStatus, BillingType } from '@prisma/client';

export const CONTRACT_REPOSITORY = Symbol('CONTRACT_REPOSITORY');

/** Contrato + cobranças (ordenadas por vencimento) + cliente mínimo. */
export type ContractWithPayments = Prisma.ContractGetPayload<{
  include: {
    payments: true; // ordenado por dueDate asc no include do infra
    client: { select: { id: true; name: true } };
  };
}>;

export interface ContractListFilter {
  ownerId: string; // filtra por client.ownerId
  clientId?: string;
  status?: ContractStatus;
  billingType?: BillingType;
  skip: number;
  take: number;
}

export interface ContractRepository {
  create(
    data: Prisma.ContractUncheckedCreateInput,
  ): Promise<ContractWithPayments>;
  findById(id: string): Promise<ContractWithPayments | null>;
  findManyAndCount(
    filter: ContractListFilter,
  ): Promise<{ data: ContractWithPayments[]; total: number }>;
  findByClient(clientId: string): Promise<ContractWithPayments[]>;
  update(
    id: string,
    data: Prisma.ContractUpdateInput,
  ): Promise<ContractWithPayments>;
  /** Contratos ACTIVE RECURRING (para o cron gerar mensalidades). */
  findActiveRecurring(): Promise<ContractWithPayments[]>;
}
```

#### Infra — Prisma contract repository

**Create**: `apps/api/src/modules/finance/infra/prisma-contract.repository.ts`
Molde: `prisma-project.repository.ts`. `include` reutilizado; `findManyAndCount` via
`$transaction([findMany, count])` com `where: { client: { ownerId }, ... }`.
```ts
const withPayments = {
  payments: { orderBy: { dueDate: 'asc' } },
  client: { select: { id: true, name: true } },
} as const;
// findManyAndCount where:
//   { client: { ownerId: filter.ownerId },
//     ...(filter.clientId ? { clientId } : {}),
//     ...(filter.status ? { status } : {}),
//     ...(filter.billingType ? { billingType } : {}) }
// orderBy: { createdAt: 'desc' }
// findActiveRecurring: findMany({ where: { status: 'ACTIVE', billingType: 'RECURRING' }, include: withPayments })
```

#### Application — ContractsService

**Create**: `apps/api/src/modules/finance/application/contracts.service.ts`
Posse via cliente (`loadOwned` no molde de `proposals.service.ts:226`). Tabela de transições.
Na criação, gera as cobranças no mesmo `create` (via `payments: { create: [...] }`).
```ts
const ALLOWED_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  ACTIVE: ['PAUSED', 'CANCELED'],
  PAUSED: ['ACTIVE', 'CANCELED'],
  FINISHED: [],
  CANCELED: [],
};

@Injectable()
export class ContractsService {
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly repo: ContractRepository,
    private readonly clients: ClientsService,
  ) {}

  async list(ownerId, query) { /* valida posse se clientId; normalizePage; repo.findManyAndCount; paginated */ }
  async listByClient(ownerId, clientId) { await this.clients.findOne(ownerId, clientId); return this.repo.findByClient(clientId); }
  async findOne(ownerId, id) { return this.loadOwned(ownerId, id); }

  async create(ownerId: string, dto: CreateContractDto): Promise<ContractWithPayments> {
    await this.clients.findOne(ownerId, dto.clientId); // posse
    if (dto.projectId) { /* opcional: validar projeto do dono — ver Dependencies */ }

    const base = {
      clientId: dto.clientId,
      projectId: dto.projectId ?? null,
      proposalId: dto.proposalId ?? null,
      description: dto.description,
      billingType: dto.billingType,
      status: 'ACTIVE' as const,
    };

    if (dto.billingType === 'INSTALLMENTS') {
      const charges = buildInstallmentSchedule({
        downPayment: dto.downPayment,
        downPaymentDueDate: dto.downPaymentDueDate ? new Date(dto.downPaymentDueDate) : null,
        installments: dto.installments!,
        installmentAmount: dto.installmentAmount!,
        firstInstallmentDueDate: new Date(dto.firstInstallmentDueDate!),
      });
      return this.repo.create({
        ...base,
        downPayment: dto.downPayment ?? null,
        installments: dto.installments!,
        installmentAmount: dto.installmentAmount!,
        payments: { create: charges.map((c) => ({ description: c.description, amount: c.amount, dueDate: c.dueDate })) },
      });
    }

    if (dto.billingType === 'ONE_TIME') {
      const charges = buildOneTimeSchedule(dto.amount!, new Date(dto.dueDate!));
      return this.repo.create({
        ...base,
        payments: { create: charges.map((c) => ({ description: c.description, amount: c.amount, dueDate: c.dueDate })) },
      });
    }

    // RECURRING — nenhuma cobrança na criação (o cron gera as mensalidades)
    return this.repo.create({
      ...base,
      monthlyAmount: dto.monthlyAmount!,
      billingDay: dto.billingDay!,
      startDate: new Date(dto.startDate!),
      endDate: dto.endDate ? new Date(dto.endDate) : null,
    });
  }

  /** Reajuste: editar monthlyAmount vale só para cobranças FUTURAS (as já geradas não mudam). */
  async update(ownerId, id, dto: UpdateContractDto) { /* loadOwned; repo.update com campos presentes; NÃO toca em payments */ }

  async pause(ownerId, id) { const c = await this.loadOwned(ownerId, id); this.assertTransition(c.status, 'PAUSED'); return this.repo.update(id, { status: 'PAUSED' }); }
  async resume(ownerId, id) { const c = await this.loadOwned(ownerId, id); this.assertTransition(c.status, 'ACTIVE'); return this.repo.update(id, { status: 'ACTIVE' }); }
  async cancel(ownerId, id) {
    const c = await this.loadOwned(ownerId, id);
    this.assertTransition(c.status, 'CANCELED');
    return this.repo.update(id, {
      status: 'CANCELED',
      payments: { updateMany: { where: { status: { in: ['PENDING', 'OVERDUE'] } }, data: { status: 'CANCELED' } } },
    });
  }

  private async loadOwned(ownerId, id) { /* repo.findById; NotFound 'Contrato não encontrado.'; clients.findOne(ownerId, c.clientId) */ }
  private assertTransition(from, to) { if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new UnprocessableEntityException('Transição de status inválida.'); }
}
```
> Nota: cancelar cancela `PENDING` **e** `OVERDUE` (ambas são cobranças em aberto). As `PAID`
> ficam no histórico.

#### API — controller e DTOs

**Create**: `apps/api/src/modules/finance/api/contracts.controller.ts`
`@Controller('contracts')`, molde de `proposals.controller.ts`, `@CurrentUserId()` em todas:
`GET /` (list), `POST /` (create), `GET /:id`, `PATCH /:id`, `POST /:id/pause`,
`POST /:id/resume`, `POST /:id/cancel`.

**Create**: `apps/api/src/modules/finance/api/dto/create-contract.dto.ts`
Campos condicionais por `billingType` (validação cruzada — usar `@ValidateIf`). Mensagens pt-BR.
```ts
export class CreateContractDto {
  @IsUUID('4', { message: 'Cliente inválido.' }) clientId: string;
  @IsOptional() @IsUUID('4', { message: 'Projeto inválido.' }) projectId?: string;
  @IsOptional() @IsUUID('4', { message: 'Proposta inválida.' }) proposalId?: string;
  @IsString() @MinLength(1, { message: 'Descrição obrigatória.' }) description: string;
  @IsEnum(BillingType, { message: 'Regime inválido.' }) billingType: BillingType;

  // RECURRING
  @ValidateIf((o) => o.billingType === 'RECURRING')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor mensal inválido.' }) @Min(0.01, { message: 'Valor mensal inválido.' })
  monthlyAmount?: number;
  @ValidateIf((o) => o.billingType === 'RECURRING')
  @IsInt() @Min(1, { message: 'Dia de vencimento entre 1 e 28.' }) @Max(28, { message: 'Dia de vencimento entre 1 e 28.' })
  billingDay?: number;
  @ValidateIf((o) => o.billingType === 'RECURRING')
  @IsDateString({}, { message: 'Data de início inválida.' }) startDate?: string;
  @IsOptional() @IsDateString({}, { message: 'Data de término inválida.' }) endDate?: string;

  // INSTALLMENTS
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da entrada inválido.' }) @Min(0) downPayment?: number;
  @IsOptional() @IsDateString({}, { message: 'Vencimento da entrada inválido.' }) downPaymentDueDate?: string;
  @ValidateIf((o) => o.billingType === 'INSTALLMENTS')
  @IsInt() @Min(1, { message: 'Informe a quantidade de parcelas.' }) installments?: number;
  @ValidateIf((o) => o.billingType === 'INSTALLMENTS')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor da parcela inválido.' }) @Min(0.01) installmentAmount?: number;
  @ValidateIf((o) => o.billingType === 'INSTALLMENTS')
  @IsDateString({}, { message: 'Vencimento da 1ª parcela inválido.' }) firstInstallmentDueDate?: string;

  // ONE_TIME
  @ValidateIf((o) => o.billingType === 'ONE_TIME')
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' }) @Min(0.01) amount?: number;
  @ValidateIf((o) => o.billingType === 'ONE_TIME')
  @IsDateString({}, { message: 'Data de vencimento inválida.' }) dueDate?: string;
}
```
**Create**: `apps/api/src/modules/finance/api/dto/update-contract.dto.ts`
Parcial e restrito: `description?`, `monthlyAmount?`, `billingDay?`, `endDate?`. **Não** permite
trocar `clientId`, `billingType`, nem os campos de INSTALLMENTS já materializados em cobranças.
**Create**: `apps/api/src/modules/finance/api/dto/list-contracts-query.dto.ts`
`extends PaginationQueryDto` + `clientId?`, `status?` (ContractStatus), `billingType?` (BillingType).

#### Module

**Create**: `apps/api/src/modules/finance/finance.module.ts`
```ts
@Module({
  imports: [ClientsModule],
  controllers: [ContractsController /* PaymentsController na Fase 2 */],
  providers: [
    ContractsService,
    { provide: CONTRACT_REPOSITORY, useClass: PrismaContractRepository },
  ],
  exports: [ContractsService], // consumido pela costura de aceite (se necessário) / ficha do cliente
})
export class FinanceModule {}
```
**Modify**: `apps/api/src/app.module.ts` — importar `FinanceModule` e adicioná-lo ao array
`imports` logo após `ProjectsModule` (linha ~32/13).

#### Specs

**Create**: `apps/api/src/modules/finance/application/schedule.spec.ts`
**Create**: `apps/api/src/modules/finance/application/contracts.service.spec.ts`
(molde `proposals.service.spec.ts` — instanciar o service com repo/clients mockados).

#### ENDPOINTS.md

**Modify**: `apps/api/ENDPOINTS.md` — adicionar a seção `## Contracts` (formato fixo:
Propósito / Auth / Body / Resposta / Erros / Handler) para as 7 rotas de contrato.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate dev --name add_contract_indexes` aplica sem erro
- [x] `pnpm --filter api build` compila sem erros de tipo
- [x] `pnpm --filter api test` — `schedule.spec.ts` e `contracts.service.spec.ts` passam
- [x] `pnpm --filter api lint` sem erros

#### Manual Verification
- [x] `POST /contracts` com `INSTALLMENTS` (entrada 1000, 8 parcelas de 500) cria 1 Entrada + 8 Parcelas; soma das cobranças = 1000 + 4000 = 5000; descrições `Entrada`, `Parcela 1/8`…`Parcela 8/8`; vencimentos mês a mês
- [x] `POST /contracts` com `ONE_TIME` cria 1 cobrança única com o vencimento informado
- [x] `POST /contracts` com `RECURRING` **não** cria cobrança nenhuma
- [x] `POST /contracts/:id/pause` → `PAUSED`; `resume` → `ACTIVE`; `cancel` → `CANCELED` e as cobranças `PENDING`/`OVERDUE` viram `CANCELED`, as `PAID` intactas
- [x] `POST /contracts/:id/resume` num contrato `CANCELED` retorna `422 Transição de status inválida.`
- [x] `GET /contracts/:id` de contrato de outro dono retorna `404 Contrato não encontrado.`

**⏸ PAUSE**: Após verificação automática, parar para confirmação manual antes da Fase 2.

---

## Phase 2: Backend — Cobranças (Payments)

### Goal
Agregado `Payment` no mesmo `FinanceModule`: `list`, `update` (editar pendente), `pay`
(baixa), `revert` (estorno não-destrutivo) e `cancel`.

### Changes

#### Domain — Payment repository

**Create**: `apps/api/src/modules/finance/domain/payment.repository.ts`
```ts
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

/** Cobrança + contrato/cliente mínimos (para lista e posse). */
export type PaymentWithContract = Prisma.PaymentGetPayload<{
  include: {
    contract: {
      select: {
        id: true; description: true; billingType: true; clientId: true;
        client: { select: { id: true; name: true } };
      };
    };
  };
}>;

export interface PaymentListFilter {
  ownerId: string; // filtra por contract.client.ownerId
  clientId?: string;
  contractId?: string;
  status?: PaymentStatus;
  billingType?: BillingType; // regime, via contract
  dueFrom?: Date;
  dueTo?: Date;
  skip: number;
  take: number;
}

export interface PaymentRepository {
  findById(id: string): Promise<PaymentWithContract | null>;
  findManyAndCount(filter: PaymentListFilter): Promise<{ data: PaymentWithContract[]; total: number }>;
  update(id: string, data: Prisma.PaymentUpdateInput): Promise<PaymentWithContract>;
  /** Existe cobrança para o contrato com este vencimento exato? (dedupe do cron) */
  existsForDueDate(contractId: string, dueDate: Date): Promise<boolean>;
  /** Cria a cobrança da mensalidade (usado pelo cron). */
  create(data: Prisma.PaymentUncheckedCreateInput): Promise<PaymentWithContract>;
  /** Marca OVERDUE toda PENDING com dueDate < now. Retorna quantas. (cron) */
  markOverdue(now: Date): Promise<number>;
}
```

#### Infra — Prisma payment repository

**Create**: `apps/api/src/modules/finance/infra/prisma-payment.repository.ts`
```ts
const withContract = {
  contract: {
    select: {
      id: true, description: true, billingType: true, clientId: true,
      client: { select: { id: true, name: true } },
    },
  },
} as const;
// findManyAndCount where:
//   { contract: { client: { ownerId }, ...(clientId ? { clientId } : {}), ...(billingType ? { billingType } : {}) },
//     ...(contractId ? { contractId } : {}),
//     ...(status ? { status } : {}),
//     ...(dueFrom || dueTo ? { dueDate: { gte: dueFrom, lte: dueTo } } : {}) }
//   orderBy: { dueDate: 'asc' }
// existsForDueDate: count({ where: { contractId, dueDate } }) > 0
// markOverdue: updateMany({ where: { status: 'PENDING', dueDate: { lt: now } }, data: { status: 'OVERDUE' } }).count
```

#### Application — PaymentsService

**Create**: `apps/api/src/modules/finance/application/payments.service.ts`
Posse via `contract.client` (o `PaymentWithContract` traz `contract.clientId`). Tabela de
transições. `revert` é não-destrutivo (nunca `delete`).
```ts
const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['PAID', 'CANCELED'],
  OVERDUE: ['PAID', 'CANCELED'],
  PAID: ['PENDING'],       // estorno
  CANCELED: [],
};

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly repo: PaymentRepository,
    private readonly clients: ClientsService,
  ) {}

  async list(ownerId, query: ListPaymentsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId);
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId, clientId: query.clientId, contractId: query.contractId,
      status: query.status, billingType: query.billingType,
      dueFrom: query.dueFrom ? new Date(query.dueFrom) : undefined,
      dueTo: query.dueTo ? new Date(query.dueTo) : undefined,
      skip, take,
    });
    return paginated(data, total, page, limit);
  }

  /** Editar cobrança APENAS enquanto PENDING (valor/vencimento/descrição). */
  async update(ownerId, id, dto: UpdatePaymentDto) {
    const p = await this.loadOwned(ownerId, id);
    if (p.status !== 'PENDING') throw new UnprocessableEntityException('Apenas cobranças pendentes podem ser editadas.');
    return this.repo.update(id, {
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.dueDate !== undefined ? { dueDate: new Date(dto.dueDate) } : {}),
    });
  }

  /** Baixa: PENDING|OVERDUE → PAID. */
  async pay(ownerId, id, dto: PayPaymentDto) {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'PAID');
    return this.repo.update(id, {
      status: 'PAID',
      paidAt: dto.paidAt ? new Date(dto.paidAt) : new Date(),
      paidAmount: dto.paidAmount ?? p.amount, // aceita valor parcial/diferente
      method: dto.method,
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
  }

  /** Estorno: PAID → PENDING; nunca exclui; registra em notes. */
  async revert(ownerId, id) {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'PENDING');
    const stamp = `Estorno em ${new Date().toISOString().slice(0, 10)}`;
    return this.repo.update(id, {
      status: 'PENDING', paidAt: null, paidAmount: null, method: null,
      notes: p.notes ? `${p.notes}\n${stamp}` : stamp,
    });
  }

  /** Cancelar: PENDING|OVERDUE → CANCELED. */
  async cancel(ownerId, id) {
    const p = await this.loadOwned(ownerId, id);
    this.assertTransition(p.status, 'CANCELED');
    return this.repo.update(id, { status: 'CANCELED' });
  }

  private async loadOwned(ownerId, id) {
    const p = await this.repo.findById(id);
    if (!p) throw new NotFoundException('Cobrança não encontrada.');
    await this.clients.findOne(ownerId, p.contract.clientId); // 404 se não for do dono
    return p;
  }
  private assertTransition(from, to) { if (!ALLOWED_TRANSITIONS[from].includes(to)) throw new UnprocessableEntityException('Transição de status inválida.'); }
}
```

#### API — controller e DTOs

**Create**: `apps/api/src/modules/finance/api/payments.controller.ts`
`@Controller('payments')`: `GET /` (list), `PATCH /:id` (update), `POST /:id/pay`,
`POST /:id/revert`, `POST /:id/cancel`.

**Create**: `apps/api/src/modules/finance/api/dto/list-payments-query.dto.ts`
`extends PaginationQueryDto` + `clientId?`, `contractId?`, `status?` (PaymentStatus),
`billingType?` (BillingType), `dueFrom?` / `dueTo?` (`@IsDateString`).
**Create**: `apps/api/src/modules/finance/api/dto/update-payment.dto.ts`
`description?` (string), `amount?` (`@IsNumber maxDecimalPlaces:2, @Min(0.01)`), `dueDate?` (`@IsDateString`).
**Create**: `apps/api/src/modules/finance/api/dto/pay-payment.dto.ts`
```ts
export class PayPaymentDto {
  @IsOptional() @IsDateString({}, { message: 'Data do pagamento inválida.' }) paidAt?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor recebido inválido.' }) @Min(0) paidAmount?: number;
  @IsEnum(PaymentMethod, { message: 'Forma de pagamento inválida.' }) method: PaymentMethod;
  @IsOptional() @IsString() notes?: string;
}
```

#### Module

**Modify**: `apps/api/src/modules/finance/finance.module.ts` — adicionar `PaymentsController`
aos controllers, `PaymentsService` e `{ provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository }`
aos providers.

#### Specs

**Create**: `apps/api/src/modules/finance/application/payments.service.spec.ts`
Casos: editar fora de PENDING → 422; `pay` seta status/paidAt/paidAmount/method; `revert`
volta a PENDING e **não** chama delete (append em notes); `cancel` de PAID → 422 (transição
inválida); posse (NotFound).

#### ENDPOINTS.md

**Modify**: `apps/api/ENDPOINTS.md` — adicionar a seção `## Payments` (5 rotas).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` compila
- [x] `pnpm --filter api test` — `payments.service.spec.ts` passa
- [x] `pnpm --filter api lint` sem erros

#### Manual Verification
- [x] `GET /payments?status=PENDING` lista com filtro; `?billingType=INSTALLMENTS` filtra por regime; `?dueFrom&dueTo` filtra por período
- [x] `POST /payments/:id/pay` com `{ method: 'PIX', paidAmount: 400 }` → `PAID`, `paidAmount=400`, `paidAt` preenchido
- [x] `POST /payments/:id/revert` numa cobrança `PAID` → `PENDING`, `paidAt/paidAmount/method` limpos, `notes` com "Estorno em …" (registro preservado)
- [x] `PATCH /payments/:id` numa cobrança `PAID` → `422 Apenas cobranças pendentes podem ser editadas.`
- [x] `POST /payments/:id/cancel` numa `PAID` → `422 Transição de status inválida.`

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 3.

---

## Phase 3: Backend — Cron diário de faturamento

### Goal
Job diário que (a) gera a mensalidade dos contratos `ACTIVE` `RECURRING` 30 dias antes do
vencimento (idempotente) e (b) marca `OVERDUE` as cobranças `PENDING` vencidas.

### Changes

**Create**: `apps/api/src/modules/finance/application/finance-billing.job.ts`
Molde exato: `proposals-expiration.job.ts`. Injeta as **interfaces** de repositório.
```ts
@Injectable()
export class FinanceBillingJob {
  private readonly logger = new Logger(FinanceBillingJob.name);
  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const now = new Date();
    const generated = await this.generateMonthly(now);
    const overdue = await this.payments.markOverdue(now);
    if (generated > 0) this.logger.log(`Mensalidades geradas: ${generated}`);
    if (overdue > 0) this.logger.log(`Cobranças vencidas: ${overdue}`);
  }

  /** Gera as mensalidades cujo vencimento cai na janela (now, now+30d], se ainda não existirem. */
  private async generateMonthly(now: Date): Promise<number> {
    const horizon = new Date(now); horizon.setDate(horizon.getDate() + 30);
    const active = await this.contracts.findActiveRecurring();
    let count = 0;
    for (const c of active) {
      if (c.billingDay == null || c.startDate == null) continue;
      const dates = billingDatesInWindow(
        { billingDay: c.billingDay, startDate: c.startDate, endDate: c.endDate ?? null },
        now, horizon,
      );
      for (const dueDate of dates) {
        if (await this.payments.existsForDueDate(c.id, dueDate)) continue; // idempotente
        const mm = String(dueDate.getMonth() + 1).padStart(2, '0');
        const yyyy = dueDate.getFullYear();
        await this.payments.create({
          contractId: c.id,
          description: `Mensalidade ${mm}/${yyyy}`,
          amount: c.monthlyAmount as unknown as number, // valor VIGENTE (reajuste vale p/ futuras)
          dueDate,
          status: 'PENDING',
        });
        count++;
      }
    }
    return count;
  }
}
```
> A idempotência vem de dois pontos: `existsForDueDate(contractId, dueDate)` antes de criar a
> mensalidade, e o `updateMany` filtrado do `markOverdue` (rodar 2× no mesmo dia não
> reprocessa). O valor da mensalidade usa o `monthlyAmount` vigente do contrato → reajuste
> afeta só as cobranças ainda não geradas.

**Modify**: `apps/api/src/modules/finance/finance.module.ts` — adicionar `FinanceBillingJob`
aos `providers`.

**Create**: `apps/api/src/modules/finance/application/finance-billing.job.spec.ts`
Casos: gera mensalidade quando não existe; **não** duplica quando `existsForDueDate` retorna
true (idempotência); pula contrato fora de `[startDate, endDate]`; chama `markOverdue(now)`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api build` compila
- [x] `pnpm --filter api test` — `finance-billing.job.spec.ts` passa (inclui caso de idempotência)
- [x] `pnpm --filter api lint` sem erros

#### Manual Verification
- [x] Com contrato `RECURRING` `ACTIVE` (billingDay hoje+15), disparar o job manualmente (ou aguardar): cria `Mensalidade MM/YYYY` com vencimento correto
- [x] Rodar o job 2× seguidas: a segunda execução **não** cria mensalidade duplicada
- [x] Contrato `PAUSED`: o job não gera mensalidade
- [x] Cobrança `PENDING` com `dueDate` no passado vira `OVERDUE` após o job

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 4.

---

## Phase 4: Frontend — Contratos

### Goal
Feature web `financeiro` com listagem de contratos, ficha (com subtabela de cobranças +
ações de baixa/estorno/cancelar) e formulário de criação/edição.

### Changes

#### API layer (self-contained — regra: feature não importa interior de outra)

**Create**: `apps/web/src/features/financeiro/api/types.ts`
Union types com as **chaves exatas** dos tradutores (`labels.ts:79-109`). Decimais chegam como
**string** (padrão de `propostas/api/types.ts`).
```ts
import type { Paginated } from '@/features/clientes/api/types';
export type { Paginated };

export type BillingType = 'RECURRING' | 'INSTALLMENTS' | 'ONE_TIME';
export type ContractStatus = 'ACTIVE' | 'PAUSED' | 'FINISHED' | 'CANCELED';
export type PaymentStatus = 'PENDING' | 'PAID' | 'OVERDUE' | 'CANCELED';
export type PaymentMethod = 'PIX' | 'TRANSFER' | 'BOLETO' | 'CARD' | 'CASH';

export interface Payment {
  id: string; contractId: string; description: string; amount: string;
  dueDate: string; status: PaymentStatus; paidAt?: string | null;
  paidAmount?: string | null; method?: PaymentMethod | null; notes?: string | null;
  contract?: { id: string; description: string; billingType: BillingType; clientId: string; client: { id: string; name: string } };
}
export interface Contract {
  id: string; clientId: string; client: { id: string; name: string };
  projectId?: string | null; proposalId?: string | null; description: string;
  billingType: BillingType; status: ContractStatus;
  monthlyAmount?: string | null; billingDay?: number | null; startDate?: string | null; endDate?: string | null;
  downPayment?: string | null; installments?: number | null; installmentAmount?: string | null;
  payments: Payment[]; createdAt: string; updatedAt: string;
}
// Bodies: CreateContractBody (união dos campos por regime — números no input),
//         UpdateContractBody (description?/monthlyAmount?/billingDay?/endDate?),
//         PayPaymentBody { method; paidAt?; paidAmount?; notes? }, UpdatePaymentBody.
// Params: ListContractsParams { page?; limit?; clientId?; status?; billingType? }
//         ListPaymentsParams { page?; limit?; clientId?; contractId?; status?; billingType?; dueFrom?; dueTo? }
```

**Create**: `apps/web/src/features/financeiro/api/contracts.api.ts`
```ts
export const contractsApi = {
  list:         (params: ListContractsParams) => api.get<Paginated<Contract>>('/contracts', { params }).then(r => r.data),
  listByClient: (clientId: string) => api.get<Paginated<Contract>>('/contracts', { params: { clientId, limit: 100 } }).then(r => r.data),
  get:          (id: string) => api.get<Contract>(`/contracts/${id}`).then(r => r.data),
  create:       (body: CreateContractBody) => api.post<Contract>('/contracts', body).then(r => r.data),
  update:       (id: string, body: UpdateContractBody) => api.patch<Contract>(`/contracts/${id}`, body).then(r => r.data),
  pause:        (id: string) => api.post<Contract>(`/contracts/${id}/pause`).then(r => r.data),
  resume:       (id: string) => api.post<Contract>(`/contracts/${id}/resume`).then(r => r.data),
  cancel:       (id: string) => api.post<Contract>(`/contracts/${id}/cancel`).then(r => r.data),
};
```
**Create**: `apps/web/src/features/financeiro/api/payments.api.ts`
```ts
export const paymentsApi = {
  list:   (params: ListPaymentsParams) => api.get<Paginated<Payment>>('/payments', { params }).then(r => r.data),
  update: (id: string, body: UpdatePaymentBody) => api.patch<Payment>(`/payments/${id}`, body).then(r => r.data),
  pay:    (id: string, body: PayPaymentBody) => api.post<Payment>(`/payments/${id}/pay`, body).then(r => r.data),
  revert: (id: string) => api.post<Payment>(`/payments/${id}/revert`).then(r => r.data),
  cancel: (id: string) => api.post<Payment>(`/payments/${id}/cancel`).then(r => r.data),
};
```
**Create**: `apps/web/src/features/financeiro/api/clients-lookup.api.ts` — cópia idêntica de
`propostas/api/clients-lookup.api.ts` (`clientsLookupApi.search`).

**Create**: `apps/web/src/features/financeiro/lib/api-error.ts` — cópia verbatim de
`propostas/lib/api-error.ts` (`extractApiMessage`).

**Create**: `apps/web/src/features/financeiro/lib/finance-format.ts`
```ts
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export function formatMoney(value?: string | number | null): string {
  if (value == null || value === '') return '—';
  return currency.format(Number(value));
}
export const CONTRACT_STATUS_BADGE: Record<ContractStatus, 'default'|'secondary'|'outline'|'destructive'> = {
  ACTIVE: 'default', PAUSED: 'outline', FINISHED: 'secondary', CANCELED: 'destructive',
};
export const PAYMENT_STATUS_BADGE: Record<PaymentStatus, 'default'|'secondary'|'outline'|'destructive'> = {
  PENDING: 'secondary', PAID: 'default', OVERDUE: 'destructive', CANCELED: 'outline',
};
```
**Create**: `apps/web/src/features/financeiro/lib/overdue.ts`
```ts
import type { Payment } from '../api/types';
/** Vencida (derivado no client): não paga/cancelada e com vencimento passado. */
export function isOverdue(p: Pick<Payment, 'dueDate' | 'status'>): boolean {
  if (p.status === 'PAID' || p.status === 'CANCELED') return false;
  const due = new Date(p.dueDate);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return due < today;
}
```
> Preferir `p.status === 'OVERDUE'` (autoritativo, vindo do cron) para o badge; `isOverdue`
> cobre o intervalo entre o vencimento e a próxima execução do cron.

#### Query keys

**Modify**: `apps/web/src/lib/query-keys.ts` — adicionar (molde `proposals`):
```ts
contracts: {
  all: ['contracts'] as const,
  list: (params: object) => ['contracts', 'list', params] as const,
  detail: (id: string) => ['contracts', 'detail', id] as const,
  byClient: (clientId: string) => ['contracts', 'client', clientId] as const,
},
payments: {
  all: ['payments'] as const,
  list: (params: object) => ['payments', 'list', params] as const,
},
```

#### Hooks (invalidação cruzada contracts ↔ payments)

**Create**: `apps/web/src/features/financeiro/api/hooks.ts`
- Queries: `useContracts(params)`, `useContractsByClient(clientId)`, `useContract(id)` (`enabled: !!id`),
  `usePayments(params)`, `useClientOptions(search)`.
- Mutations de contrato (`useCreateContract`, `useUpdateContract(id)`, `useContractAction('pause'|'resume'|'cancel')`)
  → `onSuccess` invalida **ambas** as raízes (cancelar contrato cancela cobranças):
```ts
function invalidateFinance(qc) {
  void qc.invalidateQueries({ queryKey: queryKeys.contracts.all });
  void qc.invalidateQueries({ queryKey: queryKeys.payments.all });
}
```
- Mutations de cobrança (`usePayPayment`, `useRevertPayment`, `useCancelPayment`, `useUpdatePayment(id)`)
  → mesma `invalidateFinance` (baixar/estornar muda o saldo do contrato).

#### Pages

**Create**: `apps/web/src/features/financeiro/ContratosListPage.tsx` (default export)
Molde `PropostasListPage.tsx`: `LIMIT = 20`, `page` state, `useContracts`, footer de paginação,
`ColumnRadioFilter` (local) para Status e Regime, botão "Novo contrato" abrindo
`ContratoFormDialog`. Colunas: Descrição (`TableLink` → `/financeiro/contratos/:id`), Cliente,
Regime (`translateBillingType`), Status (badge via `CONTRACT_STATUS_BADGE`, filtro),
Criado em. Skeleton (5×N), `TableEmpty colSpan`. **Adicionar branch de erro** (`isError`) — lacuna do molde.

**Create**: `apps/web/src/features/financeiro/ContratoDetalhePage.tsx` (default export)
Molde `PropostaDetalhePage.tsx`. `useParams`, `useContract(id)`. Cabeçalho com badge de status.
Ações por status (molde `isDraft`/`canDecide`):
- `ACTIVE` → Editar, Pausar, Cancelar (`ConfirmDialog` destrutivo — avisa que cancela cobranças pendentes)
- `PAUSED` → Editar, Retomar, Cancelar
- `CANCELED`/`FINISHED` → só leitura
Card de infos por regime (RECURRING: valor mensal / dia / início / término; INSTALLMENTS:
entrada / nº parcelas / valor parcela; ONE_TIME: valor / vencimento — derivado da cobrança).
**Totais** (calculados no client sobre `contract.payments`): Recebido (Σ `paidAmount` das `PAID`),
A receber (Σ `amount` das `PENDING`/`OVERDUE`), Em atraso (Σ `amount` das `OVERDUE`).
**Subtabela de cobranças**: Descrição, Vencimento (realce `text-destructive` + `Badge destructive`
"Vencida" quando `status==='OVERDUE'` ou `isOverdue`), Valor (`formatMoney`), Status (badge),
Ações por linha:
- `PENDING`/`OVERDUE`: "Dar baixa" (abre `BaixaDialog`), "Editar" (abre `CobrancaEditDialog`), "Cancelar" (`ConfirmDialog`)
- `PAID`: "Estornar" (`ConfirmDialog`) — nunca "Excluir"
- `CANCELED`: só leitura
Estados loading/erro/not-found no molde (`Empty` + `Wallet`/`FileX`).

**Create**: `apps/web/src/features/financeiro/components/BaixaDialog.tsx`
Dialog RHF+Zod: `method` (`Select` com `PAYMENT_METHOD_LABELS`), `paidAt` (`<input type="date">`,
default hoje), `paidAmount` (`MoneyInput`, default = `amount`), `notes` (textarea, obrigatório se
`paidAmount !== amount` — "valor diferente exige observação"). Usa `usePayPayment`.

**Create**: `apps/web/src/features/financeiro/components/CobrancaEditDialog.tsx`
Dialog RHF+Zod (só para `PENDING`): `description`, `amount` (`MoneyInput`), `dueDate`
(`<input type="date">`). Usa `useUpdatePayment`.

**Create**: `apps/web/src/features/financeiro/ContratoFormDialog.tsx` (named export)
Molde `ProposalFormDialog.tsx`. RHF + Zod com **campos condicionais por `billingType`**
(`Controller` + `watch('billingType')`). Cliente via `Select` + busca debounced
(`useClientOptions`) + botão "Cadastrar novo cliente" (`ClientFormDialog` de clientes).
Valores monetários com **`MoneyInput`** (`@/components/ui/money-input` via `Controller`).
Schema (esboço):
```ts
const schema = z.object({
  clientId: z.string().uuid('Selecione um cliente.'),
  description: z.string().min(1, 'Descrição obrigatória.'),
  billingType: z.enum(['RECURRING', 'INSTALLMENTS', 'ONE_TIME']),
  // RECURRING
  monthlyAmount: z.number().optional(), billingDay: z.number().optional(),
  startDate: z.string().optional(), endDate: z.string().optional(),
  // INSTALLMENTS
  downPayment: z.number().optional(), downPaymentDueDate: z.string().optional(),
  installments: z.number().optional(), installmentAmount: z.number().optional(),
  firstInstallmentDueDate: z.string().optional(),
  // ONE_TIME
  amount: z.number().optional(), dueDate: z.string().optional(),
}).superRefine((v, ctx) => {
  // exigir os campos do regime escolhido, com mensagens pt-BR (billingDay 1–28 etc.)
});
```
Props: `{ open; onOpenChange; contract?; defaultClientId?; defaultDescription?; defaultProposalId?; suggestedAmount? }`
(os `default*`/`suggested*` alimentam a costura de aceite na Fase 5). Conveniência de UI: ao
escolher INSTALLMENTS com `suggestedAmount`, sugerir `installmentAmount ≈ (suggestedAmount −
downPayment) / installments` (usuário pode editar). `onSubmit` monta o body só com os campos do
regime; `toast.success` + `onOpenChange(false)`; catch → `extractApiMessage`.

#### Aba "Contratos" na ficha do cliente

**Create**: `apps/web/src/features/financeiro/ContratosDoClienteTab.tsx`
Componente que recebe `clientId`, chama `useContractsByClient(clientId)` e lista os contratos
(tabela simples com Descrição/Regime/Status + `TableLink` para a ficha), com botão "Novo
contrato" (`ContratoFormDialog` com `defaultClientId`).

#### Router

**Modify**: `apps/web/src/routes/router.tsx`
- Importar como default: `RecebimentosPage` (Fase 5), `ContratosListPage`, `ContratoDetalhePage`.
- Substituir os 3 placeholders:
  - `/financeiro` → `<RecebimentosPage />` (Fase 5; nesta fase pode ficar placeholder ainda)
  - `/financeiro/contratos` → `<ContratosListPage />`
  - `/financeiro/contratos/:id` → `<ContratoDetalhePage />`
- Trocar a aba `contratos` da ficha do cliente (linha ~42) para renderizar `ContratosDoClienteTab`.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` compila (tsc + vite) sem erros
- [x] `pnpm --filter web lint` sem erros

#### Manual Verification
- [x] `/financeiro/contratos` lista contratos, filtra por Status e Regime, pagina
- [x] "Novo contrato" → escolher RECURRING mostra valor mensal/dia/datas; INSTALLMENTS mostra entrada/parcelas; ONE_TIME mostra valor/vencimento; campos monetários com máscara R$
- [x] Criar INSTALLMENTS → a ficha mostra a subtabela com Entrada + N parcelas e os totais corretos
- [x] "Dar baixa" numa cobrança com valor diferente exige observação; após baixa, status vira Pago e os totais atualizam (invalidação cruzada)
- [x] "Estornar" uma cobrança paga volta para Pendente (sem opção de excluir)
- [x] Pausar/Retomar/Cancelar contrato reflete na ficha; cancelar cancela as cobranças pendentes
- [x] Aba "Contratos" na ficha do cliente lista os contratos daquele cliente

**⏸ PAUSE**: Parar para confirmação manual antes da Fase 5.

---

## Phase 5: Frontend — Agenda de recebimentos + costura do aceite

### Goal
Página de agenda de recebimentos (filtros + realce de vencido + totais + ação rápida de baixa)
e o CTA "Criar contrato" na ficha de proposta aceita.

### Changes

**Create**: `apps/web/src/features/financeiro/RecebimentosPage.tsx` (default export)
Molde `MinhasDemandasPage.tsx`. Lista não-paginada (`LIMIT = 50`), server-filtered.
- Estado/filtros: `status` (`PaymentStatus | 'ALL'`), `billingType` (regime, `'ALL'`),
  `clientId` (+ busca debounced via `useClientOptions`), `month` (`<input type="month">`
  convertido em `dueFrom` = 1º dia / `dueTo` = último dia).
- `usePayments({ limit: LIMIT, status, billingType, clientId, dueFrom, dueTo })`.
- Colunas: Cobrança (descrição), Contrato (`TableLink` → `/financeiro/contratos/:id`), Cliente
  (`TableLink` → `/clientes/:id`), Regime (`translateBillingType`), Vencimento (realce
  `text-destructive` + `Badge destructive` "Vencida" quando `OVERDUE`/`isOverdue`), Valor
  (`formatMoney`), Status (badge), **Ação rápida** "Dar baixa" (`BaixaDialog`, para
  `PENDING`/`OVERDUE`).
- **Totais da seleção** (barra acima da tabela, calculados no client sobre o conjunto
  carregado): Recebido, A receber, Em atraso. Com `status=OVERDUE`, exibir também **total por
  cliente** (agrupamento client-side) — a visão de inadimplência.
- `ColumnRadioFilter` (local) para Status e Regime; skeleton + `TableEmpty`; **branch de erro** explícito.

**Modify**: `apps/web/src/routes/router.tsx` — garantir `/financeiro` → `<RecebimentosPage />`
(se ficou placeholder na Fase 4).

#### Costura "proposta aceita → sugerir criar contrato"

**Modify**: `apps/web/src/features/propostas/PropostaDetalhePage.tsx`
Quando `proposal.status === 'ACCEPTED'`, exibir botão "Criar contrato" que abre o
`ContratoFormDialog` (import de `@/features/financeiro/ContratoFormDialog` — dialog público, no
mesmo padrão do import de `ClientFormDialog`), pré-preenchendo:
```tsx
const [contratoOpen, setContratoOpen] = useState(false);
// ...
{status === 'ACCEPTED' && (
  <Button variant="outline" onClick={() => setContratoOpen(true)}>
    <FileSignature data-icon="inline-start" /> Criar contrato
  </Button>
)}
<ContratoFormDialog
  open={contratoOpen}
  onOpenChange={setContratoOpen}
  defaultClientId={proposal.clientId}
  defaultDescription={`Contrato — ${proposal.number}`}
  defaultProposalId={proposal.id}
  suggestedAmount={Number(proposal.total)}
/>
```
> Nenhuma mudança no backend `accept`. A sugestão é 100% frontend, honrando "sugere criar
> contrato" do SPEC §3.6. O `defaultProposalId` vincula o contrato à proposta de origem.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` compila
- [x] `pnpm --filter web lint` sem erros

#### Manual Verification
- [x] `/financeiro` mostra a agenda; filtrar por mês, status, regime e cliente funciona
- [x] Cobranças vencidas aparecem com realce vermelho + badge "Vencida"
- [x] A barra de totais reflete o conjunto filtrado; com `status=Vencido` mostra total por cliente
- [x] "Dar baixa" pela agenda atualiza a linha e os totais (invalidação cruzada com contratos)
- [x] Na ficha de uma proposta `ACCEPTED`, "Criar contrato" abre o form já com cliente/descrição/proposta preenchidos; ao salvar, o contrato nasce vinculado à proposta

**⏸ PAUSE**: Confirmação final.

---

## Testing Strategy

### Unit Tests (backend — foco da fase)
- `schedule.spec.ts`: `buildInstallmentSchedule` (soma fecha exatamente: `Σ amount === downPayment + installments×installmentAmount`; descrições e nº de itens corretos; vencimentos mês a mês); `buildOneTimeSchedule`; `billingDatesInWindow` (dentro/fora da janela e do intervalo start/end).
- `contracts.service.spec.ts`: posse (NotFound); geração por regime na criação; transições inválidas (422); cancelar cancela só PENDING/OVERDUE.
- `payments.service.spec.ts`: editar fora de PENDING (422); `pay` seta campos; `revert` não-destrutivo (append em notes, sem delete); transições inválidas (422).
- `finance-billing.job.spec.ts`: gera quando não existe; **idempotência** (não duplica quando `existsForDueDate` = true); respeita janela e `[startDate,endDate]`; chama `markOverdue`.

### Integration Tests
- Fluxo INSTALLMENTS: criar contrato → `GET /payments?contractId=` retorna a agenda completa; dar baixa numa parcela → totais do contrato mudam.
- Fluxo RECURRING: criar contrato → disparar job → mensalidade criada; segundo disparo não duplica; pausar → job não gera.
- Cancelar contrato → cobranças PENDING/OVERDUE viram CANCELED; PAID permanecem.

### Migration & Rollback
- Migration `add_contract_indexes` é aditiva (só cria índice) — rollback = `DROP INDEX "Contract_clientId_status_idx"`. Sem migração de dados.
- Contract/Payment já existem no `init`; nenhuma alteração de coluna.

## Environment Considerations
- **CI/CD**: sem novas etapas; `test`/`build`/`lint` já cobrem o módulo novo.
- **Migrations**: uma migration aditiva (índice). Aplicar com `prisma migrate deploy` em prod.
- **Config/Secrets**: nenhum novo env. O cron usa `ScheduleModule` já registrado.
- **Multi-environment**: o `@Cron` roda em toda instância da API; como é single-tenant e há
  processo único, não há risco de concorrência dupla. (Se um dia houver múltiplas instâncias,
  avaliar lock — fora do escopo.)

## Dependencies & Risks
- **Ordenação de fases**: Fase 2 depende de Fase 1 (contrato precisa existir); Fase 3 depende de 1+2 (repos de payment/contract); Fase 4 depende do backend (1–2); Fase 5 depende de 4 (reusa `ContratoFormDialog` e `BaixaDialog`).
- **Posse de `projectId` no create de contrato**: `FinanceModule` importa só `ClientsModule`. Se quisermos validar posse do `projectId`/`proposalId` informado, seria preciso importar `ProjectsModule`/`ProposalsModule` (ambos exportam seu service). **Decisão**: validar apenas o `clientId` (posse raiz); `projectId`/`proposalId` são opcionais e de baixo risco — aceitar sem validação cruzada nesta fase para não acoplar módulos. (Registrar como limitação conhecida.)
- **Decimais como string no front**: sempre `Number(...)` antes de cálculo/`MoneyInput`; `formatMoney` já trata.
- **Fuso/`billingDay`**: `billingDay` 1–28 evita o problema de meses curtos; `addMonths` preserva o dia. Datas de vencimento gravadas como `Date` (00:00). O realce de vencido usa comparação a meia-noite local (igual `demandas`).
- **Totais client-side**: na Recebimentos, os totais refletem só o conjunto carregado (LIMIT 50 / filtro) — documentado; endpoint de summary é trabalho futuro.

## References
- PRD: `specs/research/2026-07-23-fase-5-financeiro.md`
- SPEC de produto: `SPEC.md` §3.6; `ROADMAP.md` Fase 5
- Molde backend: `apps/api/src/modules/proposals/` (service, repo, cron, money) e `apps/api/src/modules/projects/` (dois agregados num módulo)
- Molde frontend: `apps/web/src/features/propostas/` (lista/ficha/form) e `apps/web/src/features/demandas/` (`MinhasDemandasPage`, invalidação cruzada, `isOverdue`)
