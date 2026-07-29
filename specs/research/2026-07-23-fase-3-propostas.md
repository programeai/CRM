---
date: 2026-07-23T09:41:58-03:00
researcher: claude
git_commit: c5b8e35
branch: main
topic: "Fase 3 — Propostas: itens, cálculo de total, ciclo de status, versionamento e expiração"
tags: [research, proposals, proposal-items, versioning, status-cycle, cron, decimal]
status: complete
---

# Research: Fase 3 — Propostas

## Research Question
Mapear o contexto para implementar a Fase 3 do CRM Solarz: módulo de **Propostas** — documento
comercial vinculado a um cliente (e opcionalmente a uma oportunidade), com **itens**, **cálculo de
total no backend**, **ciclo de status** validado, **versionamento** (v2, v3…) e **expiração
automática** por cron. Ver [ROADMAP.md](../../ROADMAP.md) §Fase 3 e [SPEC.md](../SPEC.md) §3.3.

## Summary

A **persistência da Fase 3 já está 100% pronta**. Os models `Proposal` e `ProposalItem`, o enum
`ProposalStatus` (6 valores), as relações (self-relation de versionamento `parent`/`versions`,
`client`, `deal`, `projects`, `contracts`, `activities`) e o índice `@@index([clientId, status])`
já existem no schema, migrados na migration `init`. **Nenhuma migration é necessária no caminho
principal** — o trabalho é criar a camada de aplicação (backend NestJS + frontend React). A única
mudança de schema *possível* é opcional e depende de uma decisão de design sobre o gerador do número
sequencial (ver Open Questions §1).

O **backend** não tem o módulo `proposals` (a busca por `*proposal*` em `apps/api/src` é vazia; os
módulos existentes são `auth`, `users`, `clients`, `contacts`, `activities`, `pipeline`). Deve-se
criar `src/modules/proposals/` seguindo **exatamente** o padrão em camadas do módulo `pipeline` (o mais
recente e consolidado): `domain/` (interface + token `Symbol`), `application/` (services + `.spec.ts`),
`infra/` (repositório Prisma, sem mapper), `api/` (controllers + DTOs class-validator pt-BR). O
`ProposalsModule` importará `ClientsModule` (posse derivada via `client.ownerId`, padrão `loadOwned`)
e `PipelineModule` (para `DealsService`: validar o `dealId` informado e, no aceite, mover o deal
vinculado para "Ganhou"). Há **três peças sem precedente no projeto** que exigem atenção:

1. **Cálculo de total no backend** com itens (`quantity × unitPrice`) menos `discount`, **sem float**.
   Hoje **não existe helper monetário** — a convenção vigente (`Deal.amount`) é `number` JS de ponta a
   ponta delegando a precisão ao `@db.Decimal` do Postgres, o que **não basta** para somar itens sem
   erro de arredondamento. Recomenda-se aritmética em centavos (inteiros) no service.
2. **Máquina de estados** (`rascunho → enviada → em negociação → aceita/recusada/expirada`) com
   transições validadas — `422` (`UnprocessableEntityException`) em transição inválida. Padrão de
   validação de transição já existe em `DealsService.move` (motivo de perda obrigatório).
3. **Cron de expiração** — `@nestjs/schedule` **não está instalado** e não há `ScheduleModule.forRoot()`
   em lugar nenhum. Precisa ser instalado e registrado em `app.module.ts`.

O **frontend** não tem a feature `propostas` (rotas `/propostas`, `/propostas/:id` e a sub-aba
`/clientes/:id/propostas` renderizam placeholders; o item de nav e o tradutor `translateProposalStatus`
**já existem**). Deve-se criar `features/propostas/` replicando os padrões de `clientes` (listagem com
Table/Badge/filtros, ficha de detalhe) e `pipeline` (form RHF+Zod, hooks TanStack Query, diálogos).
A novidade de UI é o **editor de itens** (linhas dinâmicas descrição/qtd/valor com subtotal e total
ao vivo) — sem precedente direto no projeto (o mais próximo é `useFieldArray` do RHF).

## Codebase Map

### Estado da persistência (JÁ PRONTO — não recriar)

| Item | Local | Situação |
|------|-------|----------|
| Model `Proposal` | [schema.prisma:101-130](../../apps/api/prisma/schema.prisma#L101-L130) | ✅ existe: `number @unique`, `version @default(1)`, `parentId`+`parent`/`versions` (relation `"ProposalVersions"`), `clientId`+`client`, `dealId`+`deal`, `serviceType`, `status @default(DRAFT)`, `scope`, `paymentTerms`, `deliveryTime`, `validUntil`, `discount Decimal?`, `total Decimal`, `items`, `projects`, `contracts`, `activities`, `sentAt`, `decidedAt`, `@@index([clientId, status])` |
| Model `ProposalItem` | [schema.prisma:132-140](../../apps/api/prisma/schema.prisma#L132-L140) | ✅ existe: `proposalId`+`proposal`, `description`, `quantity Decimal @default(1) @db.Decimal(10,2)`, `unitPrice Decimal @db.Decimal(12,2)`, `order Int` |
| Enum `ProposalStatus` | [schema.prisma:266-273](../../apps/api/prisma/schema.prisma#L266-L273) | ✅ `DRAFT \| SENT \| NEGOTIATING \| ACCEPTED \| REJECTED \| EXPIRED` |
| Enum `ServiceType` | [schema.prisma:260-264](../../apps/api/prisma/schema.prisma#L260-L264) | ✅ `SOFTWARE \| WEBSITE \| PAID_TRAFFIC` |
| Relações reversas | `Client.proposals` (schema.prisma:49), `Deal.proposals` (schema.prisma:93), `Project.proposalId` (schema.prisma:146-147), `Contract.proposalId` (schema.prisma:184-185), `Activity.proposalId` | ✅ ligadas (FKs `SET NULL` para deal/proposal) |
| Migrations | `apps/api/prisma/migrations/` | `20260721002325_init`, `20260721155801_add_client_address_and_indexes`. Proposal criada na `init` — **sem migration nova** no caminho principal |

**Índices ausentes a considerar** (Open Question §7): não há índice por `parentId` (usado para listar
versões) nem `unique` no par (`clientId`, `number`) além do `number @unique` global. `Project`/`Contract`
não têm índices — mas são de fases futuras, fora de escopo.

### Backend — arquivos a CRIAR (padrão de `pipeline`)

Referência canônica: [apps/api/src/modules/pipeline/](../../apps/api/src/modules/pipeline/).

| Camada | Arquivo a criar | Referência a espelhar |
|--------|-----------------|-----------------------|
| Módulo | `src/modules/proposals/proposals.module.ts` | [pipeline.module.ts](../../apps/api/src/modules/pipeline/pipeline.module.ts) (DI por token `Symbol` + `useClass`; `imports:[ClientsModule, PipelineModule]`; `exports:[ProposalsService]`) |
| domain | `.../domain/proposal.repository.ts` (interface + `Symbol('PROPOSAL_REPOSITORY')` + tipos `ProposalWith…`, filtros) | `pipeline/domain/deal.repository.ts` (usa `Prisma.ProposalGetPayload<{include:{items:true}}>`) |
| application | `.../application/proposals.service.ts` (+ `.spec.ts`) | `pipeline/application/deals.service.ts` |
| infra | `.../infra/prisma-proposal.repository.ts` | `pipeline/infra/prisma-deal.repository.ts` (`$transaction` p/ list+count; `include` const `as const`) |
| api | `.../api/proposals.controller.ts` | `pipeline/api/deals.controller.ts` (`@CurrentUserId()`, rota estática antes de paramétrica) |
| api/dto | `create-proposal.dto.ts`, `update-proposal.dto.ts`, `list-proposals-query.dto.ts`, `proposal-item.dto.ts` (+ ações: `reject` c/ motivo?) | `pipeline/api/dto/*` (`PartialType`/`OmitType`; query `extends PaginationQueryDto`; `@ValidateNested`+`@Type` para o array de itens) |
| cron | `.../application/proposals-expiration.job.ts` (ou dentro do service) `@Cron` | **novo padrão** (não há cron no projeto) |
| registro | editar [app.module.ts](../../apps/api/src/app.module.ts) | add `ScheduleModule.forRoot()` + `ProposalsModule` |
| docs (DoD) | editar [apps/api/ENDPOINTS.md](../../apps/api/ENDPOINTS.md) | add seção `## Proposals` no formato fixo |

### Frontend — arquivos a CRIAR (padrão de `clientes`/`pipeline`)

| Arquivo | Papel | Referência |
|---------|-------|------------|
| `features/propostas/api/proposals.api.ts` | chamadas axios cruas | `features/clientes/api/clients.api.ts` |
| `features/propostas/api/hooks.ts` | hooks TanStack Query + invalidação | `features/clientes/api/hooks.ts` |
| `features/propostas/api/types.ts` | `Proposal`, `ProposalItem`, bodies, params | `features/pipeline/api/types.ts` (Decimal → `string`) |
| `features/propostas/PropostasListPage.tsx` | listagem (export **default**) | `features/clientes/ClientesListPage.tsx` |
| `features/propostas/PropostaDetalhePage.tsx` | ficha: dados + itens + status + versões | `features/clientes/ClienteDetalheLayout.tsx` |
| `features/propostas/ProposalFormDialog.tsx` | criar/editar (com editor de itens) | `features/pipeline/DealFormDialog.tsx` |
| `features/propostas/components/ItemsEditor.tsx` | linhas dinâmicas de item + total ao vivo | **novo** (`useFieldArray` do RHF) |
| `features/clientes/tabs/PropostasTab.tsx` | aba na ficha do cliente | `features/clientes/tabs/OportunidadesTab.tsx` |
| editar [lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts) | add bloco `proposals` | objeto `queryKeys` |
| editar [routes/router.tsx](../../apps/web/src/routes/router.tsx) | trocar 3 placeholders | `/pipeline` → `<PipelineBoardPage/>` |

**Já prontos no frontend (reusar, não recriar):** `translateProposalStatus`/`PROPOSAL_STATUS_LABELS`
([labels.ts:44](../../apps/web/src/lib/labels.ts#L44)), item de nav Propostas
([nav.ts:32](../../apps/web/src/app/nav.ts#L32)), sub-aba `/clientes/:id/propostas` já listada em
`ClienteDetalheLayout` (hoje `<PlaceholderTab title="Propostas"/>`), `MoneyInput`, `formatDate`,
`Paginated<T>`, `extractApiMessage`.

### Existing Patterns to Follow

**Pattern: módulo NestJS com DI por token (Symbol) + imports de fronteira**
```ts
// From apps/api/src/modules/pipeline/pipeline.module.ts:12-26
@Module({
  imports: [ClientsModule],   // → proposals: [ClientsModule, PipelineModule]
  controllers: [PipelineStagesController, DealsController],
  providers: [
    DealsService,
    { provide: DEAL_REPOSITORY, useClass: PrismaDealRepository },
  ],
  exports: [DealsService],
})
export class PipelineModule {}
```
`PipelineModule` **exporta `DealsService`** → `proposals` pode injetá-lo. Token = `Symbol` no arquivo
da interface: `export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');` (deal.repository.ts:3).

**Pattern: posse derivada (Proposal terá `ownerId`? NÃO — deriva de `client.ownerId`)**
```ts
// From apps/api/src/modules/pipeline/application/deals.service.ts:120-129
private async loadOwned(ownerId: string, id: string): Promise<DealWithClient> {
  const deal = await this.repo.findById(id);
  if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
  await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
  return deal;
}
```
`ProposalsService.loadOwned` deve fazer `this.clients.findOne(ownerId, proposal.clientId)`. No create,
validar `clientId` (e `dealId`, se informado, via `this.deals.findOne(ownerId, dealId)`) do dono. A
listagem filtra na infra por `client: { ownerId }` (não há `ownerId` em Proposal).

**Pattern: validação de transição de estado → 422 (base para a máquina de status)**
```ts
// From apps/api/src/modules/pipeline/application/deals.service.ts:99-108
if (targetStage.isLost) {
  const reason = dto.lostReason?.trim();
  if (!reason) throw new UnprocessableEntityException('Informe o motivo da perda.');
  patch.lostReason = reason;
}
```
Para propostas: um mapa `ALLOWED_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]>` no service; se
`!allowed.includes(next)` → `throw new UnprocessableEntityException('Transição de status inválida.')`.

**Pattern: infra Prisma — where dinâmico + $transaction para list+count, include const**
```ts
// From apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:10-43
const withClient = { client: { select: { id: true, name: true } } } as const;
// findManyAndCount:
const where: Prisma.ProposalWhereInput = {
  client: { ownerId: filter.ownerId },
  ...(filter.clientId ? { clientId: filter.clientId } : {}),
  ...(filter.status ? { status: filter.status } : {}),
};
const [data, total] = await this.prisma.$transaction([
  this.prisma.proposal.findMany({ where, include: withItems, orderBy:{createdAt:'desc'}, skip, take }),
  this.prisma.proposal.count({ where }),
]);
```
`PrismaService` injetado **só na infra**. `ProposalItem` gravado junto via nested write
(`items: { create: [...] }`) no create; no update, substituir itens em `$transaction` (deleteMany +
create) — análogo à reindexação de `move` (deal.repository.ts:74-127).

**Pattern: DTOs class-validator pt-BR + nested array de itens**
```ts
// Base: apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts:15-44
@IsString({ message: 'A descrição é obrigatória.' }) description: string;
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'Quantidade inválida.' }) @Min(0) quantity: number;
@IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor unitário inválido.' }) @Min(0) unitPrice: number;
// no CreateProposalDto:
@IsArray() @ArrayNotEmpty({ message: 'Informe ao menos um item.' })
@ValidateNested({ each: true }) @Type(() => ProposalItemDto) items: ProposalItemDto[];
// Update: PartialType(OmitType(CreateProposalDto, ['clientId'])); Query: extends PaginationQueryDto
```
`@ArrayNotEmpty`/`each` já usados em `reorder-stages.dto.ts:1-8`. `@Type` do class-transformer já é
prática do projeto (`pagination-query.dto.ts`).

**Pattern: paginação + exceções pt-BR no service**
```ts
// From deals.service.ts:28-40 + shared/pagination.ts
const { page, limit, skip, take } = normalizePage(query.page, query.limit);
const { data, total } = await this.repo.findManyAndCount({ ownerId, ...filters, skip, take });
return paginated(data, total, page, limit); // { data, meta:{total,page,limit} }
```

**Pattern: teste de service (mock manual, sem TestingModule)**
```ts
// From deals.service.spec.ts:10-34
repo = { create: jest.fn(), findById: jest.fn(), findManyAndCount: jest.fn(), /*…*/ };
clients = { findOne: jest.fn() };
service = new ProposalsService(repo, clients as unknown as ClientsService, /*deals*/);
await expect(service.send('o','id')).rejects.toBeInstanceOf(UnprocessableEntityException);
```

**Pattern (frontend): form RHF+Zod pt-BR + Select de enum + editor de itens**
```tsx
// Base: apps/web/src/features/pipeline/DealFormDialog.tsx:27,202
const schema = z.object({
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE','WEBSITE','PAID_TRAFFIC']),
  items: z.array(z.object({
    description: z.string().min(1, 'Descrição obrigatória.'),
    quantity: z.number().min(0), unitPrice: z.number().min(0),
  })).min(1, 'Adicione ao menos um item.'),
  discount: z.number().min(0).optional(),
  validUntil: z.string().optional(), /* … */
});
// itens: useFieldArray({ control, name:'items' }); total exibido = useWatch calculando em centavos
```
`<Select>` de enum itera `Object.keys(SERVICE_TYPE_LABELS)`; `<FieldLabel required>` para obrigatórios;
`MoneyInput` via `Controller` para `unitPrice`/`discount`; submit fora do form via `form="proposal-form"`.

**Pattern (frontend): hooks TanStack Query + invalidação; listagem; abas; diálogos**
- Hooks: `useQuery`/`useMutation` com `onSuccess: () => qc.invalidateQueries({queryKey: queryKeys.proposals.all})`
  (clientes/api/hooks.ts:25 invalida lista + detalhe). Optimistic não é necessário aqui (sem drag&drop).
- Listagem: `Table`+`TableLink`+`Badge` via `Record<ProposalStatus, variant>`+`translateProposalStatus`;
  busca com `useDebouncedValue(300)`; filtro de status com `ColumnRadioFilter` (`'ALL'`→`undefined`);
  paginação `data.meta`. Modelo: `ClientesListPage.tsx`.
- Aba na ficha: `useOutletContext<Client>()` + query por cliente; modelo direto `OportunidadesTab.tsx`.
- Diálogos: primitivos `Dialog` de `components/ui/dialog.tsx` (modal-stack automático — nunca montar
  estado de empilhamento à mão). Confirmações via `ConfirmDialog`.

### Data Flow

**Criar proposta**: `ProposalFormDialog` (RHF + itens) → `POST /proposals` `{clientId, dealId?,
serviceType, items[], discount?, scope?, paymentTerms?, deliveryTime?, validUntil?}` →
`ProposalsController.create(@CurrentUserId)` → `ProposalsService.create`: valida posse do `clientId`
(e `dealId`) · **gera `number`** (PROP-AAAA-NNNN — ver Open Q §1) · **calcula `total`** em centavos a
partir de itens + desconto · status inicial `DRAFT`, `version 1` → repo grava proposta + itens (nested
create) → invalida `queryKeys.proposals`.

**Ações de status**: `POST /proposals/:id/send` (`DRAFT→SENT`, seta `sentAt`) ·
`POST /proposals/:id/accept` (`SENT|NEGOTIATING→ACCEPTED`, seta `decidedAt`; **sugere criar
Projeto/Contrato** — fases 4/5, só gancho aqui; **move o deal vinculado para "Ganhou"** via
`DealsService`) · `POST /proposals/:id/reject` (`→REJECTED`, `decidedAt`) ·
`POST /proposals/:id/new-version` (clona itens/campos, `version+1`, `parentId`=atual, status `DRAFT`).
Toda transição fora do permitido → `422`.

**Editar**: `PATCH /proposals/:id` — só editável a **versão mais recente** e (decisão) provavelmente só
em `DRAFT`/`NEGOTIATING`; recalcula `total`; substitui itens.

**Expiração (cron)**: job diário marca `status=EXPIRED` toda proposta `SENT`/`NEGOTIATING` com
`validUntil < hoje`. Consultas de dashboard (Fase 6) também tratam `validUntil` passado como expirado
(evita janela entre cron e leitura) — mesma filosofia do `OVERDUE` financeiro (schema.prisma:386).

## External Research

### Libraries & Dependencies

**`@nestjs/schedule` — NÃO instalado** (confirmado: ausente do `apps/api/package.json`, nenhum
`ScheduleModule`/`@Cron` no código). Necessário para a expiração automática. Instalar da raiz:
```bash
pnpm --filter api add @nestjs/schedule
```
Registro em `app.module.ts`: `ScheduleModule.forRoot()` nos `imports`. Job com decorator
`@Cron(CronExpression.EVERY_DAY_AT_1AM)` (ou `'0 3 * * *'`) num provider do `ProposalsModule`. É o
**primeiro cron do projeto** — a Fase 5 (financeiro) reusará o mesmo `ScheduleModule` para gerar
mensalidades e marcar `OVERDUE`, então vale deixar o registro genérico em `app.module.ts`.

**Cálculo monetário — sem biblioteca; usar inteiros (centavos).** Não há `decimal.js` nem uso de
`Prisma.Decimal` no backend. A resposta da API serializa `Decimal` como **string** (o front já trata
`Deal.amount` como `string | null`). Recomendação para `total`:
- Entrada: `quantity`/`unitPrice`/`discount` como `number` (validados `maxDecimalPlaces:2`).
- Cálculo: converter para centavos inteiros (`Math.round(x*100)`), somar `Σ round(qty*unit)`, subtrair
  desconto, dividir por 100 no fim. Evita o erro clássico de float (`0.1+0.2`). Entregar ao Prisma como
  `number` (coerção para `@db.Decimal(12,2)`), consistente com a convenção `Deal.amount`.
- **Não** confiar no `total` vindo do cliente — sempre recalcular no service (SPEC §4: "total é sempre
  recalculado no backend").

**React Hook Form `useFieldArray`** (já temos `react-hook-form`): para o editor de linhas de item
(`append`/`remove`/`fields`), com `useWatch` no array para exibir subtotais e total ao vivo no cliente
(o valor oficial vem do backend após salvar).

### Reference Implementations

Sem necessidade de referência externa nova — todos os padrões são internos (módulo `pipeline` para
backend; `clientes`/`pipeline` para frontend). O único componente sem precedente (editor de itens com
`useFieldArray`) é um padrão RHF padrão; documentação:
[RHF useFieldArray](https://react-hook-form.com/docs/usefieldarray).

## Historical Context

- **SPEC.md §3.3** ([SPEC.md:101-124](../SPEC.md#L101-L124)): estrutura (número sequencial, cliente,
  deal opcional, itens, desconto, condições/prazo/validade, escopo markdown); ciclo de status; regra
  "editar enviada gera nova versão, só a mais recente é editável"; "aceita sugere criar Projeto e move
  a oportunidade para Ganhou"; dashboard usa propostas p/ conversão.
- **SPEC.md §5** ([SPEC.md:401](../SPEC.md#L401)): endpoints previstos —
  `GET/POST /proposals` · `GET/PATCH /proposals/:id` · `POST /proposals/:id/send` · `/accept` ·
  `/reject` · `/new-version`.
- **SPEC.md §5** ([SPEC.md:414-417](../SPEC.md#L414-L417)): cron diário item 1 — "marca propostas
  vencidas como `EXPIRED`". Transições validadas no service → `422`.
- **SPEC.md §4** ([SPEC.md:382-384](../SPEC.md#L382-L384)): valores sempre `Decimal(12,2)`, nunca
  float; `total` sempre recalculado no backend; índice `Proposal(clientId, status)` (já existe).
- **ROADMAP.md §Fase 3** ([ROADMAP.md:104-114](../../ROADMAP.md#L104-L114)): 7 itens — CRUD; ações
  send/accept/reject/new-version; itens com total no backend; ciclo de status (422); versionamento
  (só a última editável); expiração por cron; aceita sugere Projeto e Contrato.
- **Fase 2 (concluída, este PRD é o sucessor direto)**: estabeleceu o padrão de módulo em camadas,
  posse derivada via `ClientsService`, paginação, RHF+Zod, TanStack Query, diálogos modal-stack. Ver
  [research Fase 2](2026-07-21-fase-2-pipeline.md) e [plano Fase 2](../plans/2026-07-21-fase-2-pipeline.md).
- **ENDPOINTS.md** (Definition of Done): formato fixo por endpoint — `### MÉTODO /caminho` + `Propósito`,
  `Auth`, `Body`, `Resposta`, `Erros`, `Handler` (`arquivo → Classe.metodo`). **Não** há seção Proposals
  ainda; adicionar `## Proposals` no mesmo commit dos controllers.
- **Deferido da Fase 2**: "criar Projeto ao mover para Ganhou" ficou para a Fase 4. Na Fase 3, o aceite
  de proposta **move o deal para Ganhou** (isso é possível hoje) mas **só sugere** Projeto/Contrato
  (módulos inexistentes) — sem criação real.

## Constraints & Considerations

- **Interface 100% pt-BR** (regra absoluta): Zod, class-validator, toasts, exceções Nest.
- **`Proposal` NÃO tem `ownerId`**: posse sempre derivada via `client.ownerId` (padrão `loadOwned`);
  listagem filtra na infra por `client: { ownerId }`.
- **Decimal, nunca float**: `total`/`discount`/`unitPrice` `Decimal(12,2)`, `quantity` `Decimal(10,2)`.
  Somar itens **em centavos inteiros** no service; no front usar `MoneyInput` e `Number(string)` só
  para exibição (`formatDealAmount` é o modelo — criar `formatMoney` genérico se preferir).
- **`total` recalculado no backend** — ignorar qualquer `total` do cliente.
- **Versionamento**: `new-version` cria nova linha (não muta a anterior); só a `version` mais recente
  de uma cadeia (`parentId`) é editável. Decidir como identificar "a mais recente" (ver Open Q §2).
- **Máquina de estados**: transições válidas no service, `422` em transição inválida. `EXPIRED` só via
  cron/derivação, nunca por ação manual do usuário.
- **Cron é novidade**: instalar `@nestjs/schedule` + `ScheduleModule.forRoot()` em `app.module.ts`.
  Idempotência: o job só faz `updateMany` de `SENT|NEGOTIATING` com `validUntil < now` → `EXPIRED`
  (naturalmente idempotente). Testar via chamada direta ao método (não depender do agendador no teste).
- **FKs `SET NULL`**: `Project.proposalId`/`Contract.proposalId`/`Activity.proposalId` são `SET NULL`;
  excluir proposta (se houver `DELETE`) não quebra relações — mas SPEC/roadmap **não listam DELETE**
  de proposta (ver Open Q §5).
- **`db:reset`** ([apps/api/package.json](../../apps/api/package.json)) roda o seed; não há script
  `migrate dev` dedicado. Se a decisão do gerador de número exigir schema novo (Open Q §1), será a
  primeira migration desde a `init`.
- **Sem migration no caminho principal** — schema Proposal/ProposalItem já migrado.

## Open Questions

Precisam de decisão no `/spec`:

1. **Gerador do número sequencial (`PROP-AAAA-NNNN`)** — não existe mecanismo hoje. Opções: (a) contar
   propostas do ano via `count`/`max` e `+1` no service dentro de uma transação (simples, mas exige
   cuidado com concorrência — em single-user é seguro); (b) tabela/sequence dedicada no Postgres
   (migration nova, robusto); (c) coluna `seq Int @default(autoincrement())` + formatação na leitura.
   O ano é o do `createdAt`? Reseta a cada ano?
   → *Recomendação: (a) — `max(seq do ano) + 1` em `$transaction` no create; single-user torna corrida
   improvável e evita migration. Ano = ano corrente na criação; reinicia por ano.*

2. **Como determinar "a versão mais recente editável"** — por `MAX(version)` dentro da cadeia
   (`parentId`), por um flag `isLatest`, ou "a que não tem filhos em `versions`"? O `new-version`
   preserva o `number` e incrementa `version`, ou gera `number` novo?
   → *Recomendação: mesma `number`, `version+1`; a mais recente é a de maior `version` na cadeia (raiz =
   `parentId null`); editável só se for a de maior versão E status em `DRAFT`/`NEGOTIATING`.*

3. **Quais status permitem edição de conteúdo (`PATCH`)** — só `DRAFT`? `DRAFT` e `NEGOTIATING`? Editar
   uma `SENT` deve **forçar** `new-version` (SPEC: "editar uma enviada gera nova versão")?
   → *Recomendação: `PATCH` livre em `DRAFT`; em `SENT`/`NEGOTIATING` a UI oferece "nova versão" em vez
   de editar; `ACCEPTED`/`REJECTED`/`EXPIRED` são imutáveis.*

4. **Escopo do "aceita sugere criar Projeto e Contrato"** — Projetos (Fase 4) e Contratos (Fase 5) não
   existem. Na Fase 3: (a) só marcar `ACCEPTED` + mover deal para "Ganhou"; (b) também deixar CTA
   placeholder na UI.
   → *Recomendação: (a) — `accept` seta `ACCEPTED`/`decidedAt` e, se houver `dealId`, move o deal para o
   estágio `isWon` via `DealsService`; sugestão de Projeto/Contrato fica para as fases 4/5.*

5. **Existe `DELETE /proposals/:id`?** SPEC §5 e roadmap **não listam**. Rascunhos errados precisam ser
   removíveis? Ou usar arquivamento/soft-delete como clientes?
   → *Recomendação: sem `DELETE` no MVP (coerente com SPEC); permitir excluir **apenas rascunhos**
   (`DRAFT`) é um incremento opcional — decidir no /spec.*

6. **Cron: horário e granularidade** — `@Cron` diário (que horário?); marca também `NEGOTIATING`
   além de `SENT`? Propostas sem `validUntil` nunca expiram (correto?).
   → *Recomendação: diário às 03:00; expira `SENT` e `NEGOTIATING` com `validUntil < hoje`; sem
   `validUntil` = nunca expira.*

7. **Índices adicionais** — vale um `@@index([parentId])` (listar versões) e/ou tratar `number` por ano?
   → *Recomendação: adicionar `@@index([parentId])` se a UI listar versões com frequência; caso
   contrário, o `parentId` isolado é raro o bastante para dispensar. Decidir junto de §1 (se houver
   migration, incluir o índice).*

8. **Granularidade da ficha `/propostas/:id`** — página única com seções (dados + itens + histórico de
   versões + timeline) ou sub-abas como a ficha do cliente?
   → *Recomendação: página única com seções (proposta é mais "documento" que "entidade com muitas
   relações"); versões como lista lateral/accordion.*

## Code References Index

- [apps/api/prisma/schema.prisma:101-130](../../apps/api/prisma/schema.prisma#L101-L130) — model `Proposal` (+ self-relation de versões, `@@index([clientId,status])`)
- [apps/api/prisma/schema.prisma:132-140](../../apps/api/prisma/schema.prisma#L132-L140) — model `ProposalItem`
- [apps/api/prisma/schema.prisma:266-273](../../apps/api/prisma/schema.prisma#L266-L273) — enum `ProposalStatus`
- [apps/api/prisma/schema.prisma:260-264](../../apps/api/prisma/schema.prisma#L260-L264) — enum `ServiceType`
- `apps/api/prisma/migrations/20260721002325_init/` — Proposal já migrada (sem migration nova no caminho principal)
- [apps/api/src/modules/pipeline/pipeline.module.ts](../../apps/api/src/modules/pipeline/pipeline.module.ts) — módulo com 2 controllers/services + DI por token; `imports:[ClientsModule]`; `exports:[…Service]`
- `apps/api/src/modules/pipeline/domain/deal.repository.ts` — interface + `Symbol` token + `Prisma.…GetPayload` + filtros
- `apps/api/src/modules/pipeline/application/deals.service.ts:93-129` — validação de transição (422) + `loadOwned` (posse via ClientsService)
- `apps/api/src/modules/pipeline/application/deals.service.spec.ts:10-92` — padrão de teste (mock manual, `rejects.toBeInstanceOf`)
- `apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:10-127` — `$transaction` list+count, `include` const, reindex transacional (modelo p/ substituir itens)
- `apps/api/src/modules/pipeline/api/deals.controller.ts:18-66` — `@CurrentUserId()`, rotas de ação, estática antes de paramétrica
- `apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts:15-44` — DTO class-validator pt-BR
- `apps/api/src/modules/pipeline/api/dto/reorder-stages.dto.ts:1-8` — `@IsArray`/`@ArrayNotEmpty`/`each` (modelo p/ array de itens)
- `apps/api/src/modules/clients/application/clients.service.ts:47-51` — `findOne(ownerId, id)` (base da posse)
- `apps/api/src/shared/pagination.ts` — `normalizePage`, `paginated`, `DEFAULT_LIMIT=20`, `MAX_LIMIT=100`
- `apps/api/src/shared/current-user.decorator.ts:5-12` — `@CurrentUserId` (`req.user.sub`)
- [apps/api/src/shared/dto/pagination-query.dto.ts:4-16](../../apps/api/src/shared/dto/pagination-query.dto.ts#L4-L16) — base de query DTOs (`@Type(()=>Number)`)
- [apps/api/src/app.module.ts](../../apps/api/src/app.module.ts) — registrar `ScheduleModule.forRoot()` + `ProposalsModule`; `APP_GUARD` JWT global
- [apps/api/package.json](../../apps/api/package.json) — `@nestjs/schedule` ausente (instalar); Prisma 6.19.3
- [apps/api/ENDPOINTS.md:11-17](../../apps/api/ENDPOINTS.md#L11-L17) — formato fixo por endpoint (DoD)
- `apps/web/src/features/pipeline/DealFormDialog.tsx:27,202` — form RHF+Zod pt-BR + Select de enum + submit externo
- `apps/web/src/features/pipeline/api/hooks.ts` — hooks TanStack Query + invalidação (+ optimistic, não necessário aqui)
- `apps/web/src/features/pipeline/api/types.ts:21,31` — Decimal→`string`; `CreateBody`/`UpdateBody=Partial<Omit<…>>`
- `apps/web/src/features/pipeline/lib/deal-format.ts:1` — `formatDealAmount` (`Intl.NumberFormat pt-BR/BRL`)
- `apps/web/src/features/clientes/ClientesListPage.tsx:30,102,144,203` — Table/TableLink/Badge, busca debounce, filtro coluna, estados
- `apps/web/src/features/clientes/ClienteDetalheLayout.tsx:41-49,130` — sub-abas `SectionTabs` + `<Outlet context={client}/>` (aba Propostas já listada)
- `apps/web/src/features/clientes/tabs/OportunidadesTab.tsx` — modelo direto p/ `PropostasTab`
- `apps/web/src/features/clientes/api/hooks.ts:25` — invalidação lista + detalhe
- [apps/web/src/lib/labels.ts:44](../../apps/web/src/lib/labels.ts#L44) — `PROPOSAL_STATUS_LABELS`/`translateProposalStatus` (JÁ EXISTE)
- [apps/web/src/lib/query-keys.ts](../../apps/web/src/lib/query-keys.ts) — objeto `queryKeys` (add bloco `proposals`)
- [apps/web/src/routes/router.tsx:33,39](../../apps/web/src/routes/router.tsx#L33-L39) — placeholders `/propostas`, `/propostas/:id`, `/clientes/:id/propostas` (trocar)
- [apps/web/src/app/nav.ts:32](../../apps/web/src/app/nav.ts#L32) — item de nav Propostas (já existe)
- `apps/web/src/components/ui/dialog.tsx:15` — `Dialog` com modal-stack automático
- `apps/web/src/components/ui/money-input.tsx` — `MoneyInput` (reais → centavos)
