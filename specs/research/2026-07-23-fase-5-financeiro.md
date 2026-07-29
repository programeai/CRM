---
date: 2026-07-23T17:21:14-03:00
researcher: claude
git_commit: 73e0fea47caa3109749fa355172bfb4b2948d8c7
branch: main
topic: "Fase 5 — Financeiro (contratos, cobranças, agenda, baixa/estorno, crons)"
tags: [research, contracts, payments, finance, cron, decimal]
status: complete
---

# Research: Fase 5 — Financeiro

## Research Question

Implementar a Fase 5 do roadmap: **Financeiro** — controle de receitas por contrato nos três
regimes (mensalidade `RECURRING`, entrada + parcelas `INSTALLMENTS`, à vista `ONE_TIME`), com
geração de agenda de cobranças, baixa manual e estorno, cron diário (gerar mensalidade + marcar
vencidos), e visões de agenda de recebimentos / contratos / inadimplência. Ver [SPEC.md §3.6](../SPEC.md)
e o [ROADMAP.md — Fase 5](../../ROADMAP.md).

## Summary

O modelo de dados **já existe por inteiro** no schema (`Contract`, `Payment`, e os quatro enums
`BillingType`/`ContractStatus`/`PaymentStatus`/`PaymentMethod`), criado na migration `init` e nunca
usado por código. Nenhum arquivo em `apps/api/src/` referencia Contract/Payment hoje. Portanto a Fase 5
é majoritariamente **construção de módulo NestJS + feature web**, e provavelmente só precisa de uma
migration incremental opcional (índice em `Contract`, que hoje não tem nenhum `@@index`). Os índices de
`Payment` (`[contractId, status]` e `[dueDate, status]`) já cobrem exatamente as consultas do cron.

O backend deve **clonar o módulo `proposals`** — que é o padrão mais próximo e mais maduro: tem
repository pattern com token DI, cálculo monetário puro em centavos (`money.ts`), **cron diário já em
produção** (`proposals-expiration.job.ts` via `@nestjs/schedule`, já instalado e registrado no AppModule),
transições de status validadas por tabela declarativa (422), paginação compartilhada (`shared/pagination.ts`)
e specs que instanciam o service com repositórios mockados. O precedente de **dois agregados num só módulo**
(`projects` = Project + Task) mostra como acomodar `Contract` + `Payment` num único `FinanceModule`.

O frontend deve clonar `propostas` (listagem paginada, ficha com ações por status, form dialog) e
`demandas` (`MinhasDemandasPage` é o molde exato da "Agenda de recebimentos": lista com filtros de
cliente/data/coluna + realce de atrasado derivado no client). **Já prontos**: os 4 tradutores de enum em
`lib/labels.ts`, o grupo de nav "Financeiro" e as 3 rotas placeholder (`/financeiro`,
`/financeiro/contratos`, `/financeiro/contratos/:id`) + aba "Contratos" na ficha do cliente.

## Codebase Map

### Estado do modelo de dados (já pronto)

| Arquivo | Linhas | Conteúdo |
|---|---|---|
| `apps/api/prisma/schema.prisma` | L183-L206 | `Contract`: `clientId` (obrigatório), `projectId?`, `proposalId?`, `description`, `billingType`, `status @default(ACTIVE)`; RECURRING (`monthlyAmount`, `billingDay` 1–28, `startDate`, `endDate?`); INSTALLMENTS (`downPayment`, `installments`, `installmentAmount`). **Sem `@@index`, sem `ownerId`.** |
| `apps/api/prisma/schema.prisma` | L208-L225 | `Payment`: `contractId`, `description`, `amount Decimal(12,2)`, `dueDate`, `status @default(PENDING)`, `paidAt?`, `paidAmount?` (recebimento parcial/diferente), `method?`, `notes?`. Índices `@@index([contractId, status])` e `@@index([dueDate, status])`. |
| `apps/api/prisma/schema.prisma` | L302-L328 | Enums `BillingType`, `ContractStatus` (ACTIVE/PAUSED/FINISHED/CANCELED), `PaymentStatus` (PENDING/PAID/OVERDUE/CANCELED), `PaymentMethod` (PIX/TRANSFER/BOLETO/CARD/CASH). |
| `apps/api/prisma/schema.prisma` | L123, L157 | Relações inversas `Proposal.contracts` e `Project.contracts` já declaradas. |

Migration base: `apps/api/prisma/migrations/20260721002325_init/migration.sql:189` (`CREATE TABLE "Contract"`) e `:211` (`CREATE TABLE "Payment"`). Convenção de nome: `<AAAAMMDDHHMMSS>_<snake_case_inglês>`.

### Arquivos a criar — Backend

Novo módulo em `apps/api/src/modules/finance/` (dois agregados, espelhando `projects/`):

| Arquivo | Papel |
|---|---|
| `finance.module.ts` | Imports `ClientsModule` (posse via cliente); providers com 2 tokens DI; providers do cron; exporta `ContractsService` (para o hook de aceite). |
| `domain/contract.repository.ts` | Token `CONTRACT_REPOSITORY` + interface + tipos `Prisma.ContractGetPayload`. |
| `domain/payment.repository.ts` | Token `PAYMENT_REPOSITORY` + interface (inclui `generateMonthlyDue`, `markOverdue` para o cron). |
| `application/contracts.service.ts` (+ `.spec.ts`) | CRUD + `pause`/`resume`/`cancel` + geração da agenda de parcelas na criação. |
| `application/payments.service.ts` (+ `.spec.ts`) | `list`, `update` (editar pendente), `pay`/`revert`/`cancel`. |
| `application/finance-billing.job.ts` (+ `.spec.ts`) | Cron diário: gera mensalidade 30 dias antes + marca OVERDUE. |
| `application/money.ts` | Reuso do padrão de `proposals/application/money.ts` (centavos). Pode ser copiado para a feature. |
| `infra/prisma-contract.repository.ts`, `infra/prisma-payment.repository.ts` | Implementações Prisma. |
| `api/contracts.controller.ts`, `api/payments.controller.ts` | Controllers `@Controller('contracts')` / `@Controller('payments')`. |
| `api/dto/*.dto.ts` | create/update/list-query para contract e payment, `pay` dto (valor/forma/observação). |

Registro do módulo: adicionar `FinanceModule` em `apps/api/src/app.module.ts` após `ProjectsModule` (L32). Documentar rotas em `apps/api/ENDPOINTS.md` (Definition of Done).

### Arquivos a criar — Frontend

Nova feature em `apps/web/src/features/financeiro/` (molde: `propostas` + `demandas`):

| Arquivo | Molde |
|---|---|
| `api/types.ts` | Union types dos 4 enums (chaves exatas dos labels); `Contract`, `Payment`, bodies; re-exporta `Paginated`. |
| `api/contracts.api.ts`, `api/payments.api.ts` | Objetos axios `.then(r => r.data)`. |
| `api/hooks.ts` | TanStack Query (useQuery/useMutation + invalidação cruzada contracts↔payments). |
| `api/clients-lookup.api.ts`, `lib/api-error.ts` | Cópias locais idênticas (regra: feature não importa interior de outra). |
| `lib/finance-format.ts` | `formatMoney` (copiar de `propostas/lib/proposal-format.ts`) + mapas de Badge variant. |
| `lib/overdue.ts` | `isOverdue(payment)` (status !== 'PAID' && dueDate < hoje) ou usar `status === 'OVERDUE'` da API. |
| `RecebimentosPage.tsx` | **Agenda de recebimentos** — molde `MinhasDemandasPage.tsx` (filtros + realce). Substitui placeholder `/financeiro`. |
| `ContratosListPage.tsx` | Lista paginada — molde `PropostasListPage.tsx`. Substitui `/financeiro/contratos`. |
| `ContratoDetalhePage.tsx` | Ficha + subtabela de cobranças + ações — molde `PropostaDetalhePage.tsx`. Substitui `/financeiro/contratos/:id`. |
| `ContratoFormDialog.tsx` | Criar/editar via Dialog + RHF + Zod, campos condicionais por `billingType`. |

Ajustes centrais: adicionar chaves `contracts`/`payments` em `apps/web/src/lib/query-keys.ts`; trocar os 3 placeholders em `apps/web/src/routes/router.tsx:51-56` e a aba `contratos` do cliente (`router.tsx:42`) pelas telas reais.

### Já prontos (não recriar)

- **Enums traduzidos** — `apps/web/src/lib/labels.ts:79-109`: `translateBillingType`, `translateContractStatus`, `translatePaymentStatus`, `translatePaymentMethod` (usar as chaves exatas dos mapas nos union types).
- **Nav** — `apps/web/src/app/nav.ts:43`: grupo "Financeiro" com itens `/financeiro` (ícone `Wallet`) e `/financeiro/contratos` (`FileSignature`).
- **Rotas placeholder** — `apps/web/src/routes/router.tsx:51-56` + aba `contratos` (`:42`).
- **`@nestjs/schedule`** — instalado (`package.json:34`, `^6.1.3`) e registrado (`app.module.ts:24`, `ScheduleModule.forRoot()`).
- **Paginação** — `apps/api/src/shared/pagination.ts` (`normalizePage`, `paginated`) + `shared/dto/pagination-query.dto.ts` (`PaginationQueryDto`).

## Existing Patterns to Follow

**Pattern: Cron diário (molde exato para o job de faturamento)**
```ts
// apps/api/src/modules/proposals/application/proposals-expiration.job.ts
@Injectable()
export class ProposalsExpirationJob {
  private readonly logger = new Logger(ProposalsExpirationJob.name);
  constructor(@Inject(PROPOSAL_REPOSITORY) private readonly repo: ProposalRepository) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const count = await this.repo.expireOverdue(new Date());
    if (count > 0) this.logger.log(`Propostas expiradas: ${count}`);
  }
}
```
**Por quê**: o job vive na `application/` do módulo, é registrado como provider comum, injeta a **interface de repositório** (nunca PrismaService), e a idempotência vem do `updateMany` filtrado (rodar 2× não reprocessa). Para a Fase 5, dois efeitos idempotentes: (a) gerar a mensalidade do mês (dedupe pela existência de Payment naquele mês/contrato); (b) `updateMany` de PENDING com `dueDate < now` → OVERDUE.

**Pattern: Cálculo monetário em centavos (evita float)**
```ts
// apps/api/src/modules/proposals/application/money.ts
export function toCents(v: number) { return Math.round(v * 100); }
export function fromCents(c: number) { return c / 100; }
// total = Σ round(qty × unit) − round(discount), piso em 0; grava number no Decimal(12,2)
```
**Por quê**: o código de negócio nunca usa `Prisma.Decimal` — arredonda por item em centavos e grava `number`; o Prisma converte para `Decimal(12,2)`. A agenda de parcelas deve seguir isso: dividir o total em centavos e ajustar a última parcela pelo resto para fechar a soma exata.

**Pattern: Transições de status validadas (422)**
```ts
// proposals.service.ts:22 — tabela declarativa + assertTransition → UnprocessableEntityException
const ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  DRAFT: ['SENT'], SENT: ['NEGOTIATING','ACCEPTED','REJECTED'], /* terminais: [] */ };
```
**Por quê**: para Contract (`pause`/`resume`/`cancel`) e Payment (`pay`/`revert`/`cancel`), a mesma tabela declarativa + `assertTransition` lançando 422 em transição inválida, mensagem pt-BR.

**Pattern: Posse derivada via cliente (sem `ownerId` na entidade)**
```ts
// proposals.service.ts:226 — loadOwned
const c = await this.repo.findById(id);
if (!c) throw new NotFoundException('Contrato não encontrado.');
await this.clients.findOne(ownerId, c.clientId); // 404 se não for do dono
```
**Por quê**: nem `Contract` nem `Payment` têm `ownerId` (single-tenant via `client`). Contract → posse via `clientId`; Payment → posse via `contract.clientId` (join), espelhando Task→Project→Client da Fase 4.

**Pattern: Repository com token DI + include reutilizado**
```ts
// domain: export const CONTRACT_REPOSITORY = Symbol('CONTRACT_REPOSITORY');
// module:  { provide: CONTRACT_REPOSITORY, useClass: PrismaContractRepository }
// infra:   const withPayments = { payments: { orderBy: { dueDate: 'asc' } }, client: { select: { id, name } } } as const;
//          findManyAndCount → $transaction([findMany, count]); where: { client: { ownerId } }
```

**Pattern: Frontend — Agenda de recebimentos (molde `MinhasDemandasPage`)**
```tsx
// realce de atrasado derivado no client (lib/overdue.ts + célula)
const overdue = isOverdue(payment);
<span className={overdue ? 'text-destructive' : undefined}>{formatDate(payment.dueDate) || '—'}</span>
{overdue && <Badge variant="destructive">Vencida</Badge>}
```
**Por quê**: lista não paginada (`LIMIT = 50`), filtros de cliente (lookup com debounce), data (`<input type="date">`) e coluna (`ColumnRadioFilter` replicado localmente), com ação rápida de "dar baixa" no lugar do link.

**Pattern: Frontend — invalidação cruzada de cache**
```ts
// demandas/api/hooks.ts:79 — pagar uma parcela muda o saldo do contrato → invalidar ambas as raízes
void qc.invalidateQueries({ queryKey: queryKeys.payments.all });
void qc.invalidateQueries({ queryKey: queryKeys.contracts.all });
```

## Data Flow

**Criar contrato INSTALLMENTS** → `ContractsService.create` valida posse do cliente, monta o Contract, e no mesmo fluxo gera **todas** as cobranças (Entrada + N parcelas) via repositório (`payments: { create: [...] }`), descrições `"Entrada"`/`"Parcela 3/8"`, valores em centavos com ajuste na última parcela.

**Criar contrato RECURRING** → nenhuma cobrança criada na hora; o cron diário cria a mensalidade do mês 30 dias antes do vencimento (`billingDay`), enquanto `status === ACTIVE`. Pausar suspende a geração (pendentes permanecem).

**Criar contrato ONE_TIME** → uma única cobrança com vencimento.

**Cron diário** (`finance-billing.job.ts`, `EVERY_DAY_AT_3AM`) → (1) para cada contrato RECURRING ativo, gera a mensalidade se ainda não existe (idempotente por contrato+competência); (2) `updateMany` PENDING com `dueDate < hoje` → OVERDUE.

**Baixa manual** → `PaymentsService.pay(id, { paidAt, paidAmount, method, notes })` → PENDING/OVERDUE → PAID. **Estorno** → `revert` → PAID → PENDING (registra em `notes`; nunca exclui pago — regra §3.6). **Cancelar contrato** → cancela cobranças PENDING (pagas ficam no histórico).

**Proposta aceita → sugere criar contrato**: hoje `ProposalsService.accept` (proposals.service.ts:178) move o deal para `isWon` e o Projeto é semeado dentro de `DealsService.move` (efeito colateral idempotente via `findByDealId`). Ver **Open Questions** sobre onde costurar a criação/sugestão do Contrato.

## Historical Context

- `specs/research/2026-07-23-fase-4-demandas.md:212-213` — decisão de que aceitar proposta só marca `ACCEPTED`/move deal; **Contrato (Fase 5) deferido**. FKs `Contract.proposalId` e `Activity.proposalId` são `SET NULL`.
- `specs/research/2026-07-23-fase-4-demandas.md:229` — questão análoga resolvida na Fase 4: criar-ao-ganhar **automático em `deals.move`** vs. sugestão via dialog. Escolheu-se automático.
- `specs/research/2026-07-20-fase-0-fundacao.md:276-278, 388` — rotas de financeiro já previstas desde a fundação; campos do Contract criados no `init` mesmo sem uso, para evitar migrations incrementais.
- ROADMAP marca a Fase 5 como "a fase mais densa — testes de regra críticos" ([ROADMAP.md:132](ROADMAP.md#L132)).

## Constraints & Considerations

- **Dinheiro nunca em float** — replicar `money.ts` (centavos); gravar `number` no `Decimal(12,2)`. A soma das parcelas geradas deve fechar exatamente com o total (ajuste do resto na última).
- **Idempotência do cron** é obrigatória (roda todo dia): a geração de mensalidade precisa de uma chave de dedupe (contrato + mês/ano de competência). Avaliar consulta por `dueDate` no mês ou um campo de competência.
- **Índice em `Contract`** — hoje sem nenhum `@@index`; as listas filtram por `clientId`/`status`. Migration incremental opcional `add_contract_indexes` (`@@index([clientId, status])`). Os índices de `Payment` já bastam para o cron.
- **Testes de regra críticos** (Definition of Done da fase): geração de agenda (soma fecha), transições inválidas (422), estorno não-destrutivo, idempotência do cron, cancelamento cancelando só pendentes.
- **`ENDPOINTS.md`** — adicionar seções Contracts e Payments no mesmo commit (formato fixo: Propósito/Auth/Body/Resposta/Erros/Handler).
- **pt-BR** em toda mensagem (exceções, validação, toasts, estados de UI); enums sempre via tradutores.
- **Sem input mascarado de moeda** no web hoje (usa `<input type="number">`); manter esse padrão salvo decisão contrária no `/spec`.

## Open Questions

1. **Onde costurar "proposta aceita → contrato"?** O `accept` tem a proposta em mãos (valores, condições de pagamento) mas o `deals.move` não. Opções: (a) criar o Contrato automaticamente em `proposals.accept` (idempotente por `proposalId`), pré-preenchendo valor/condições; (b) apenas **sugerir** via CTA/dialog no frontend (SPEC §3.6 diz "sugere criar contrato", o que aponta para não-automático). **Decisão para o `/spec`.**
2. **Um `FinanceModule` único (Contract+Payment) ou dois módulos** (`ContractsModule`/`PaymentsModule`)? Precedente `projects` favorece um módulo único com dois agregados.
3. **Competência da mensalidade** — como deduplicar a geração do cron: por intervalo de `dueDate` no mês, ou adicionar um campo de competência (`Payment.period`/`competenceMonth`) via migration? Sem campo, a dedupe fica por range de data.
4. **Reajuste de mensalidade** (SPEC §3.6: "editar o valor vale para as próximas cobranças") — editar `Contract.monthlyAmount` afeta só cobranças futuras; confirmar que cobranças já geradas não são retroativamente alteradas.
5. **Migration incremental** — criar `add_contract_indexes` agora, ou deferir até haver volume? (baixo custo, recomendável já criar).

## Code References Index

- `apps/api/prisma/schema.prisma:183-206` — model `Contract` (sem `@@index`, sem `ownerId`).
- `apps/api/prisma/schema.prisma:208-225` — model `Payment` (índices `[contractId,status]`, `[dueDate,status]`).
- `apps/api/prisma/schema.prisma:302-328` — enums financeiros.
- `apps/api/src/modules/proposals/proposals.module.ts:11-18` — imports/providers/exports + cron como provider.
- `apps/api/src/modules/proposals/application/proposals.service.ts:22-30` — tabela de transições.
- `apps/api/src/modules/proposals/application/proposals.service.ts:178-188, 243-254` — accept → moveDealToWon.
- `apps/api/src/modules/proposals/application/proposals.service.ts:226-234` — loadOwned (posse via cliente).
- `apps/api/src/modules/proposals/application/money.ts:1-26` — cálculo em centavos.
- `apps/api/src/modules/proposals/application/proposals-expiration.job.ts` — cron diário (molde).
- `apps/api/src/modules/proposals/infra/prisma-proposal.repository.ts:29-46, 106-115` — findManyAndCount + expireOverdue (updateMany idempotente).
- `apps/api/src/modules/projects/application/projects.service.ts:102-112` — createFromDeal (efeito idempotente).
- `apps/api/src/shared/pagination.ts` — `normalizePage`/`paginated`.
- `apps/api/src/shared/dto/pagination-query.dto.ts` — `PaginationQueryDto`.
- `apps/api/src/app.module.ts:24, 32` — `ScheduleModule.forRoot()`, `ProjectsModule` (ponto de registro).
- `apps/api/ENDPOINTS.md:323-329` — formato de endpoint (exemplo accept).
- `apps/web/src/lib/labels.ts:79-109` — 4 tradutores financeiros.
- `apps/web/src/lib/query-keys.ts` — factory (adicionar contracts/payments).
- `apps/web/src/app/nav.ts:43` — grupo "Financeiro".
- `apps/web/src/routes/router.tsx:42, 51-56` — placeholders financeiro + aba contratos.
- `apps/web/src/features/demandas/MinhasDemandasPage.tsx` — molde da Agenda de recebimentos (filtros + `isOverdue`).
- `apps/web/src/features/demandas/api/hooks.ts:79, 106` — invalidação cruzada + optimistic update.
- `apps/web/src/features/propostas/lib/proposal-format.ts` — `formatMoney` (copiar).
- `apps/web/src/lib/format.ts` — `formatDate`/`formatDateTime`.
