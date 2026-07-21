---
date: 2026-07-21T14:40:35-03:00
researcher: claude
git_commit: 26d71f5
branch: main
topic: "Fase 2 — Pipeline: estágios configuráveis e Kanban de oportunidades (deals)"
tags: [research, pipeline, deals, stages, kanban, dnd-kit]
status: complete
---

# Research: Fase 2 — Pipeline (estágios + Kanban de oportunidades)

## Research Question
Mapear o contexto para implementar a Fase 2 do CRM Solarz: estágios configuráveis
(`PipelineStage`) e Kanban de oportunidades (`Deal`) com drag & drop, ordenação manual,
motivo de perda obrigatório e indicador "esfriando". Ver [ROADMAP.md](../../ROADMAP.md) §Fase 2
e [SPEC.md](../../SPEC.md) §3.2.

## Summary

A **persistência da Fase 2 já está 100% pronta**. Os models `PipelineStage` e `Deal`, o enum
`ServiceType`, o índice `Deal(stageId, position)` e o seed dos 7 estágios padrão (em pt-BR) já
existem no schema, migrados na migration `init`. **Nenhuma migration nova é necessária** para o
caminho principal — o trabalho é criar a camada de aplicação (backend NestJS + frontend React).

O **backend** ainda não tem os módulos: `apps/api/src/modules/` só contém `activities`, `auth`,
`clients`, `contacts`, `users`. Deve-se criar o(s) módulo(s) de pipeline seguindo o padrão em
camadas já consolidado (`domain`/`application`/`infra`/`api`) de `clients`/`contacts`. Ponto
crítico: `Deal` e `PipelineStage` **não têm `ownerId`** — a posse de um deal é derivada via
`client.ownerId`, então o `DealsService` deve validar posse chamando `ClientsService.findOne()`
exatamente como `ContactsService` faz (padrão `loadOwned`).

O **frontend** não tem feature `pipeline` (a rota `/pipeline` renderiza `<PlaceholderPage>`; o
item de nav já existe). Deve-se criar `features/pipeline/` replicando os padrões de `clientes`
(3-arquivos `api/`, TanStack Query com `query-keys`, formulário RHF+Zod+Controller). O Kanban
exige **dnd-kit, que não está instalado** — recomenda-se o stack clássico
(`@dnd-kit/core@6.3.1` + `@dnd-kit/sortable@10.0.0` + `@dnd-kit/utilities@3.2.2`), compatível com
o React 19 do projeto. `translateServiceType`/`SERVICE_TYPE_LABELS` já existem; os nomes de
estágio são texto livre do banco (sem tradutor).

## Codebase Map

### Estado da persistência (JÁ PRONTO — não recriar)

| Item | Local | Situação |
|------|-------|----------|
| Model `PipelineStage` | `apps/api/prisma/schema.prisma:70-77` | ✅ existe (`id`, `name @unique`, `order`, `isWon`, `isLost`, `deals`) — **sem `ownerId`** (stages globais, single-tenant) |
| Model `Deal` | `apps/api/prisma/schema.prisma:79-99` | ✅ existe (campos completos + `@@index([stageId, position])`) — **sem `ownerId`** |
| Enum `ServiceType` | `apps/api/prisma/schema.prisma:260-264` | ✅ `SOFTWARE \| WEBSITE \| PAID_TRAFFIC` |
| Tabela física + índice | `apps/api/prisma/migrations/20260721002325_init/migration.sql:88-115,247,250` | ✅ migradas (`Deal_stageId_position_idx` na linha 250) |
| FKs | mesma migration `:274,277,286,316` | ✅ `Deal→Client` RESTRICT, `Deal→PipelineStage` RESTRICT, `Proposal.dealId`/`Activity.dealId` SET NULL |
| Seed 7 estágios | `apps/api/prisma/seed.ts` | ✅ upsert idempotente por `name`; `Ganhou` (isWon), `Perdeu` (isLost) |
| Relações inversas | `schema.prisma:48` (Client), `:110-111` (Proposal), `:226-227` (Activity) | ✅ ligadas |

### Backend — arquivos a CRIAR (padrão de `clients`/`contacts`)

Estrutura em camadas (referência: módulo `clients`):

| Camada | Arquivo a criar | Referência a espelhar |
|--------|-----------------|-----------------------|
| Módulo | `apps/api/src/modules/pipeline/pipeline.module.ts` | `modules/clients/clients.module.ts` (DI via token Symbol + `useClass`; `imports:[ClientsModule]`) |
| domain | `.../domain/deal.repository.ts` (interface + `Symbol('DEAL_REPOSITORY')` + filtros) | `modules/clients/domain/client.repository.ts` |
| domain | `.../domain/pipeline-stage.repository.ts` | idem |
| application | `.../application/deals.service.ts` (+ `.spec.ts`) | `modules/clients/application/clients.service.ts` |
| application | `.../application/pipeline-stages.service.ts` (+ `.spec.ts`) | idem |
| infra | `.../infra/prisma-deal.repository.ts` | `modules/clients/infra/prisma-client.repository.ts` |
| infra | `.../infra/prisma-pipeline-stage.repository.ts` | idem |
| api | `.../api/deals.controller.ts` + `dto/*` | `modules/clients/api/clients.controller.ts` + `dto/` |
| api | `.../api/pipeline-stages.controller.ts` + `dto/*` | idem |
| registro | editar `apps/api/src/app.module.ts:imports[]` | adicionar `PipelineModule` |
| docs (DoD) | editar `apps/api/ENDPOINTS.md` | formato fixo por endpoint (ver §Historical) |

### Frontend — arquivos a CRIAR (padrão de `clientes`)

| Arquivo | Papel | Referência |
|---------|-------|------------|
| `apps/web/src/features/pipeline/api/deals.api.ts` | chamadas axios cruas | `features/clientes/api/clients.api.ts` |
| `apps/web/src/features/pipeline/api/stages.api.ts` | idem (stages) | idem |
| `apps/web/src/features/pipeline/api/hooks.ts` | hooks TanStack Query | `features/clientes/api/hooks.ts` |
| `apps/web/src/features/pipeline/api/types.ts` | `Deal`, `PipelineStage`, params | `features/clientes/api/types.ts` |
| `apps/web/src/features/pipeline/PipelineBoardPage.tsx` | página do Kanban (export **default**) | `features/clientes/ClientesListPage.tsx` |
| `apps/web/src/features/pipeline/DealFormDialog.tsx` | criar/editar deal | `features/clientes/ClientFormDialog.tsx` |
| `.../pipeline/components/KanbanColumn.tsx`, `SortableDealCard.tsx` | board dnd-kit | (novo — ver External Research) |
| editar `apps/web/src/lib/query-keys.ts` | add bloco `deals`/`stages` | `lib/query-keys.ts:1-11` |
| editar `apps/web/src/routes/router.tsx:35` | trocar `<PlaceholderPage title="Pipeline" />` por página real | `router.tsx:22-34` (padrão import estático) |

### Existing Patterns to Follow

**Pattern: módulo NestJS com DI por token (Symbol)**
```ts
// From apps/api/src/modules/clients/clients.module.ts
@Module({
  controllers: [ClientsController],
  providers: [
    ClientsService,
    { provide: CLIENT_REPOSITORY, useClass: PrismaClientRepository },
  ],
  exports: [ClientsService],
})
export class ClientsModule {}
```
**Why this matters**: o `PipelineModule` deve declarar `imports: [ClientsModule]` para injetar
`ClientsService` e validar posse do cliente dono do deal.

**Pattern: posse derivada via service do pai (Deal não tem ownerId)**
```ts
// From apps/api/src/modules/contacts/application/contacts.service.ts:56-64
private async loadOwned(ownerId: string, contactId: string): Promise<Contact> {
  const contact = await this.repo.findById(contactId);
  if (!contact) throw new NotFoundException('Contato não encontrado.');
  await this.clients.findOne(ownerId, contact.clientId); // 404 se não for do dono
  return contact;
}
```
**Why this matters**: `DealsService` precisa checar `ClientsService.findOne(ownerId, deal.clientId)`
tanto ao carregar um deal quanto ao criar (validar que o `clientId` informado pertence ao dono).

**Pattern: controller — ownerId, paginação, sem guard local**
```ts
// From apps/api/src/modules/clients/api/clients.controller.ts
@Controller('clients')
export class ClientsController {
  @Get()   list(@CurrentUserId() ownerId: string, @Query() q: ListClientsQueryDto) { ... }
  @Post()  create(@CurrentUserId() ownerId: string, @Body() dto: CreateClientDto) { ... }
  @Patch(':id') update(@CurrentUserId() ownerId, @Param('id') id, @Body() dto) { ... }
}
```
`@CurrentUserId()` lê `req.user.sub` (`apps/api/src/shared/current-user.decorator.ts:5-12`). O
`JwtAuthGuard` é **global** via `APP_GUARD` (`app.module.ts`), não há `@UseGuards` local.

**Pattern: service — normalizePage + envelope paginado + exceções pt-BR**
```ts
// From apps/api/src/modules/clients/application/clients.service.ts:34-51
const { page, limit, skip, take } = normalizePage(query.page, query.limit); // shared/pagination.ts
const { data, total } = await this.repo.findManyAndCount({ ownerId, ...filters, skip, take });
return paginated(data, total, page, limit); // → { data, meta:{total,page,limit} }
// ...
if (!client) throw new NotFoundException('Cliente não encontrado.');
```
Helpers em `apps/api/src/shared/pagination.ts` (`normalizePage`, `paginated`, `DEFAULT_LIMIT=20`,
`MAX_LIMIT=100`).

**Pattern: infra Prisma — where dinâmico + $transaction para list+count**
```ts
// From apps/api/src/modules/clients/infra/prisma-client.repository.ts:21-47
const where: Prisma.DealWhereInput = { ...(filter.stageId ? { stageId } : {}), ... };
const [data, total] = await this.prisma.$transaction([
  this.prisma.deal.findMany({ where, orderBy: {...}, skip, take }),
  this.prisma.deal.count({ where }),
]);
```
`PrismaService` é injetado **apenas na infra** (`apps/api/src/prisma/prisma.service.ts`, módulo
`@Global()` em `prisma.module.ts`). Regra do `apps/api/CLAUDE.md`: application nunca importa Prisma.

**Pattern: DTOs class-validator em pt-BR**
```ts
// From apps/api/src/modules/clients/api/dto/create-client.dto.ts (adaptar p/ Deal)
@IsString({ message: 'O título é obrigatório.' }) title: string;
@IsUUID('4', { message: 'Cliente inválido.' }) clientId: string;
@IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' }) serviceType: ServiceType;
@IsOptional() @IsInt() @Min(0) @Max(100, {message:'...'}) probability?: number;
// Update: export class UpdateDealDto extends PartialType(CreateDealDto) {}
// Query estende PaginationQueryDto (shared/dto/pagination-query.dto.ts) + @Type(()=>Number)
```

**Pattern: teste de service (injeção manual do mock, sem TestingModule)**
```ts
// From apps/api/src/modules/clients/application/clients.service.spec.ts
repo = { findById: jest.fn(), findManyAndCount: jest.fn(), ... } as jest.Mocked<DealRepository>;
service = new DealsService(repo, clientsServiceMock);
await expect(service.findOne('owner','nope')).rejects.toBeInstanceOf(NotFoundException);
```

**Pattern: frontend api/ (3 arquivos) + hooks TanStack Query**
```ts
// From apps/web/src/features/clientes/api/clients.api.ts
export const dealsApi = {
  list: (p) => api.get<Paginated<Deal>>('/deals', { params: p }).then(r => r.data),
  move: (id, body) => api.patch<Deal>(`/deals/${id}/move`, body).then(r => r.data),
};
// From apps/web/src/features/clientes/api/hooks.ts — mutation invalida no onSuccess
onSuccess: () => { void qc.invalidateQueries({ queryKey: queryKeys.deals.all }); }
```
`queryKeys` centralizado em `apps/web/src/lib/query-keys.ts:1-11` (add `deals:{all,list,board}`,
`stages:{all}`). Axios em `apps/web/src/lib/api.ts` (baseURL `/api/v1`, refresh 401 automático).

**Pattern: formulário RHF + Zod + Controller/Select de enum**
```tsx
// From apps/web/src/features/clientes/ClientFormDialog.tsx:463-485
<Controller control={control} name="serviceType" render={({ field }) => (
  <Select<ServiceType> value={field.value} onValueChange={field.onChange}>
    <SelectTrigger /><SelectContent>
      {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map(s =>
        <SelectItem key={s} value={s}>{translateServiceType(s)}</SelectItem>)}
    </SelectContent>
  </Select>
)} />
```
Reusar helpers: `blank()` (`''`→`undefined` no submit), `extractApiMessage(error, fallback)`,
`toast.success/error` pt-BR, botão submit no `DialogFooter` com `form="deal-form"`.
`MoneyInput` (`components/ui/money-input`) para o campo `amount`.

**Pattern: labels de enum**
```ts
// From apps/web/src/lib/labels.ts:37-42 — JÁ EXISTE, reusar
export const SERVICE_TYPE_LABELS = { SOFTWARE:'Software', WEBSITE:'Website', PAID_TRAFFIC:'Tráfego pago' } as const;
export const translateServiceType = make(SERVICE_TYPE_LABELS);
```
Nomes de estágio vêm de `stage.name` (texto livre pt-BR do banco) — exibidos crus, **sem tradutor**.

### Data Flow

**Criar deal**: `DealFormDialog` (RHF) → `POST /deals` `{title, clientId, serviceType, amount?, probability?, expectedClose?}` → `DealsController.create(@CurrentUserId)` → `DealsService.create` valida `clientId` do dono (`ClientsService.findOne`) + `position` = fim da coluna do stage default → `PrismaDealRepository.create` → invalida `queryKeys.deals`.

**Mover deal (drag & drop)**: card arrastado no board → `onDragEnd` calcula `{stageId, position}` → `useMoveDeal` optimistic update no cache → `PATCH /deals/:id/move` → `DealsService.move` (valida posse; se stage destino `isLost` exige `lostReason`; reindexa coluna(s) em `$transaction`; atualiza `stageMovedAt`) → `onSettled` invalida/reconcilia.

**Carregar board**: `GET /deals` agrupado por `stageId` (ver Open Question sobre paginação) + `GET /pipeline-stages` ordenado por `order` → agrupar client-side por `stageId`, ordenar por `position`.

## External Research

### Libraries & Dependencies

**dnd-kit — NÃO instalado.** Instalar (pnpm workspaces, da raiz):
```bash
pnpm --filter web add @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```
Versões estáveis: `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2`.
Peer dep `react >=16.8.0` → **funciona no React 19 do projeto sem warning**. (Existe `@dnd-kit/react@0.5.0`
novo, mas é 0.x/API instável — não usar; ficar no stack clássico.)

**`@nestjs/schedule` — NÃO instalado.** Só necessário SE o indicador "esfriando" for via cron.
Recomendação: derivar "esfriando" no client a partir de `Deal.stageMovedAt` (dias parados > threshold),
**sem cron** — evita a dependência. Ver Open Questions.

### Reference Implementations (padrão canônico dnd-kit Kanban)

Um `DndContext` para o board · um `SortableContext` (`verticalListSortingStrategy`) por coluna ·
`useSortable` por card · coluna também `useDroppable` (para soltar em coluna vazia) ·
`PointerSensor` com `activationConstraint:{distance:8}` (não rouba o clique) · `closestCorners`.

```tsx
// Handlers: onDragOver = troca de coluna (feedback ao vivo); onDragEnd = ordem final + persistência
function handleDragEnd({ active, over }: DragEndEvent) {
  setActiveDeal(null);
  if (!over) return;
  const stageId = findStageId(over.id as string); // over pode ser card OU coluna vazia
  // arrayMove dentro da coluna → newPosition = índice final
  moveDeal.mutate({ dealId: active.id as string, stageId, position: newPosition });
}
```
`DragOverlay` renderiza o card "fantasma" (guardar `activeDeal` no `onDragStart`); no card original
`opacity: isDragging ? 0.4 : 1`.

**Optimistic update (TanStack Query v5)**: `onMutate` cancela queries em voo + snapshot + patch no
cache; `onError` rollback + `toast.error` pt-BR; `onSettled` invalida. Idealmente derivar o board
do cache do React Query (via `useMemo` agrupando por `stageId`/`position`) em vez de `useState`
paralelo — mantém a fonte de verdade única (regra do `apps/web/CLAUDE.md`).

**`position`**: inteiro sequencial 0-based reindexado no backend (`$transaction`). Fracionário/gap
é over-engineering para board single-user — não usar.

Fontes: [dnd-kit Multiple Sortable Lists](https://dndkit.com/react/guides/multiple-sortable-lists/) ·
[Sortable preset](https://dndkit.com/legacy/presets/sortable/overview/) ·
[@dnd-kit/core npm](https://www.npmjs.com/package/@dnd-kit/core) ·
[exemplo TS+Tailwind](https://github.com/delciopolanco/kanban) ·
[TanStack Query optimistic updates](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates).

## Historical Context

- **SPEC.md §3.2** (linhas 80-99): estágios padrão editáveis; campos do deal; regras (motivo de
  perda obrigatório ao ir p/ "Perdeu"; drag & drop + ordenação manual; "esfriando" > X dias,
  default 7; "Ganhou" sugere criar Projeto).
- **SPEC.md §5** (linhas 399-400): endpoints previstos —
  `GET/POST /pipeline-stages` · `PATCH/DELETE /pipeline-stages/:id` ·
  `GET/POST /deals` · `GET/PATCH/DELETE /deals/:id` · `PATCH /deals/:id/move` (stage + position).
- **SPEC.md §4** (linha 384): índice `Deal(stageId, position)` (já existe).
- **ROADMAP.md §Fase 2**: 5 itens — estágios configuráveis; deals CRUD + move; motivo de perda +
  "esfriando"; Kanban dnd-kit + optimistic; "Ganhou" sugere Projeto.
- **Fase 1 (concluída, commit `e0ed75e`)**: estabeleceu todos os padrões acima (arquitetura em
  camadas, TanStack Query, RHF+Zod, paginação). Ver [plano Fase 1](../plans/2026-07-21-fase-1-clientes.md).
- **ENDPOINTS.md** (Definition of Done): formato fixo por endpoint — `Propósito`, `Auth`, `Body`,
  `Resposta`, `Erros`, `Handler`. Toda rota nova entra no mesmo commit.
- **Nav**: item Pipeline já existe em `apps/web/src/app/nav.ts:31` (`/pipeline`, ícone `KanbanSquare`, grupo "Comercial").

## Constraints & Considerations

- **Interface 100% pt-BR** (regra absoluta): validações Zod/class-validator, toasts, exceções Nest.
- **`Deal`/`PipelineStage` sem `ownerId`**: posse sempre derivada via `client.ownerId`; consultas de
  deal por id **não** filtram por owner no Prisma — checar em 2 etapas no service (padrão `loadOwned`).
- **Decimal, nunca float**: `amount` é `Decimal(12,2)`; no front usar `MoneyInput`.
- **Board precisa de TODOS os deals** agrupados por stage, mas `GET /deals` é paginado — ver Open Q.
- **Estágios terminais** `isWon`/`isLost`: `Ganhou`/`Perdeu`. Mover p/ `isLost` exige `lostReason` (422 se ausente).
- **FKs RESTRICT** (`Deal→Client`, `Deal→PipelineStage`): não dá para deletar cliente/estágio com deals — tratar erro Prisma P2003 e retornar mensagem pt-BR ao tentar excluir estágio em uso.
- **Reindexação de `position`** em transação para não deixar posições duplicadas/furadas.
- **Sem migration nova** no caminho principal (schema pronto). Só haveria migration se decisões
  abaixo mudarem o modelo (ex.: adicionar campo).
- **`db:reset`** (`apps/api/package.json:19`) roda o seed; não há script `migrate dev`/`seed` dedicado.

## Open Questions

Precisam de decisão no `/spec`:

1. **Escopo de configuração de estágios**: a Fase 2 entrega CRUD completo de estágios com UI de
   configuração (criar/renomear/reordenar/excluir, marcar `isWon`/`isLost`), ou apenas leitura dos
   7 estágios do seed + endpoints prontos sem tela dedicada? (Roadmap diz "estágios configuráveis".)
   → *Recomendação: endpoints CRUD completos + uma tela de configuração enxuta; reordenar estágios via drag ou campo `order`.*

2. **Indicador "esfriando"**: derivar no client a partir de `stageMovedAt` (sem `@nestjs/schedule`)
   ou via cron diário? O threshold (default 7 dias) é fixo ou configurável?
   → *Recomendação: derivar no client (dias desde `stageMovedAt`), threshold constante 7 dias no MVP; evita a dependência de cron.*

3. **Endpoint do board vs paginação**: o board precisa de todos os deals ativos agrupados por stage.
   Usar `GET /deals?limit=alto`, um `GET /deals?view=board` sem paginação, ou paginar por coluna?
   → *Recomendação: `GET /deals` aceitar filtro por stage e um modo board (sem paginação) que retorna todos os deals não-arquivados agrupados; manter também a listagem paginada.*

4. **"Mover para Ganhou sugere criar Projeto"**: Projeto é Fase 4 (não existe módulo). Na Fase 2,
   apenas permitir mover para `Ganhou` sem ação de projeto, ou já deixar um gancho/CTA placeholder?
   → *Recomendação: só mover para `Ganhou` na Fase 2; a sugestão de criar Projeto fica para a Fase 4.*

5. **Deals na ficha do cliente**: adicionar uma aba "Oportunidades" no detalhe do cliente nesta fase,
   ou só o board global `/pipeline`? (Hoje o detalhe tem placeholders de Propostas/Projetos/Contratos,
   não de Oportunidades.)
   → *Recomendação: board global agora; aba na ficha é incremento opcional/menor.*

6. **Exclusão de deal**: `DELETE /deals/:id` é hard delete (SPEC lista DELETE) — confirmar que deal
   não usa soft delete como cliente. E o que fazer com propostas/atividades vinculadas (FK SET NULL já cobre).
   → *Recomendação: hard delete conforme SPEC; FKs SET NULL já preservam proposals/activities.*

7. **Granularidade do módulo**: um único `PipelineModule` (stages + deals juntos) ou módulos
   separados `PipelineStagesModule` + `DealsModule`? (Fase 1 separou `contacts`/`activities`.)
   → *Recomendação: um `PipelineModule` cobrindo stages + deals (coesos), com dois controllers/services internos.*

## Code References Index

- `apps/api/prisma/schema.prisma:70-77` — model `PipelineStage` (sem ownerId)
- `apps/api/prisma/schema.prisma:79-99` — model `Deal` (+ `@@index([stageId, position])`)
- `apps/api/prisma/schema.prisma:260-264` — enum `ServiceType`
- `apps/api/prisma/migrations/20260721002325_init/migration.sql:88-115,247,250,274,277` — tabelas/índice/FKs
- `apps/api/prisma/seed.ts` — seed dos 7 estágios (idempotente) + admin
- `apps/api/src/modules/clients/clients.module.ts` — padrão de módulo + DI por token
- `apps/api/src/modules/clients/api/clients.controller.ts` — padrão controller (`@CurrentUserId`)
- `apps/api/src/modules/clients/application/clients.service.ts:34-51,77-94` — paginação + exceções pt-BR
- `apps/api/src/modules/clients/domain/client.repository.ts` — interface + `Symbol` token + filtro
- `apps/api/src/modules/clients/infra/prisma-client.repository.ts:21-56` — where dinâmico + `$transaction` + updateMany
- `apps/api/src/modules/clients/application/clients.service.spec.ts` — padrão de teste (mock manual)
- `apps/api/src/modules/contacts/application/contacts.service.ts:56-64` — `loadOwned` (posse via service do pai)
- `apps/api/src/modules/contacts/contacts.module.ts:2,9` — `imports:[ClientsModule]`
- `apps/api/src/shared/current-user.decorator.ts:5-12` — `@CurrentUserId` (`req.user.sub`)
- `apps/api/src/shared/pagination.ts` — `normalizePage`, `paginated`, limites
- `apps/api/src/shared/dto/pagination-query.dto.ts` — `PaginationQueryDto` (base de query DTOs)
- `apps/api/src/prisma/prisma.module.ts` — `@Global()` PrismaModule
- `apps/api/src/app.module.ts` — registro de módulos + `APP_GUARD` (JWT global)
- `apps/api/ENDPOINTS.md:1-6` — formato fixo da doc de endpoints (DoD)
- `apps/api/package.json:35,61` — Prisma 6.19.3; `@nestjs/schedule` ausente
- `apps/web/src/features/clientes/api/clients.api.ts` — padrão axios `api/`
- `apps/web/src/features/clientes/api/hooks.ts` — padrão TanStack Query + invalidação
- `apps/web/src/features/clientes/api/types.ts:42,49-65` — tipos, `Paginated<T>`, `Activity.dealId`
- `apps/web/src/features/clientes/ClientesListPage.tsx:30-38,47-93` — listagem, badge, filtros
- `apps/web/src/features/clientes/ClientFormDialog.tsx:463-485` — Controller+Select de enum
- `apps/web/src/lib/labels.ts:37-42` — `SERVICE_TYPE_LABELS`/`translateServiceType` (reusar)
- `apps/web/src/lib/query-keys.ts:1-11` — objeto `queryKeys` (add `deals`/`stages`)
- `apps/web/src/lib/api.ts:10-52` — axios (Bearer + refresh 401)
- `apps/web/src/main.tsx:12-16` — `QueryClient` + providers
- `apps/web/src/routes/router.tsx:35` — `/pipeline` → `<PlaceholderPage>` (trocar)
- `apps/web/src/app/nav.ts:31` — item de nav Pipeline (já existe)
- `apps/web/package.json` — React 19; dnd-kit ausente
- `apps/web/src/components/ui/` — 31 componentes (Table, Badge, Dialog, Select, MoneyInput, etc.); sem Kanban/DnD
