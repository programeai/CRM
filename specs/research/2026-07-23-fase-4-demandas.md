---
date: 2026-07-23T00:00:00-03:00
researcher: claude
git_commit: 1122a04035c09163bafdee5256f5baa895c8d643
branch: main
topic: "Fase 4 — Demandas (Projetos + Tarefas, Kanban por projeto, Minhas demandas, criar Projeto ao ganhar)"
tags: [research, projects, tasks, kanban, dnd-kit, project-on-won]
status: complete
---

# Research: Fase 4 — Demandas (Projetos e Tarefas)

## Research Question

Fase 4 do roadmap: **Demandas** — organização do trabalho após a venda. Escopo (SPEC.md §3.4, ROADMAP.md Fase 4):
- **Projetos**: `GET/POST /projects`, `GET/PATCH /projects/:id`
- **Tarefas**: `GET/POST /tasks` (com filtros), `GET/PATCH/DELETE /tasks/:id`, `PATCH /tasks/:id/move`
- **Kanban por projeto** (dnd-kit) + checklist de subtarefas
- **Visão "Minhas demandas"** cruzando projetos (filtros: prioridade, prazo, cliente)
- **Destaque de demandas atrasadas**
- **Criar Projeto automaticamente ao ganhar oportunidade** — deferido da Fase 2/3

## Summary

O schema Prisma **já define** `model Project`, `model Task` e os três enums (`ProjectStatus`, `TaskStatus`, `TaskPriority`) — nenhuma migration nova é necessária para o núcleo (ver [schema.prisma:142-176](apps/api/prisma/schema.prisma#L142-L176), [:275-295](apps/api/prisma/schema.prisma#L275-L295)). Porém **não existe nenhum código**: não há módulo `projects`/`tasks` em `apps/api/src/modules/`, nenhuma rota documentada em `ENDPOINTS.md`, e no frontend as rotas `/demandas` e `/projetos/:id` (mais a aba "Projetos" da ficha do cliente) são apenas `PlaceholderPage`. Toda a Fase 4 é greenfield, mas com os modelos de dados e a UI-shell (nav, rotas placeholder) prontos.

Os padrões a clonar já estão maduros e verificados em dois módulos-referência. **Backend**: a arquitetura em camadas (`domain`/`application`/`infra`/`api`), o repository pattern com token DI, a derivação de posse via serviço do módulo-pai, o reindexação de posições em `$transaction` (drag & drop) e o `@Cron` (para destacar atrasadas) vêm do módulo `pipeline` (Fase 2) e `proposals` (Fase 3). `Task` tem `position Int` + `@@index([projectId, status, position])`, ou seja o Kanban-por-status é o modelo pretendido — o `PATCH /tasks/:id/move` é o análogo exato de `PATCH /deals/:id/move`. **Frontend**: a stack dnd-kit com update otimista + rollback (`pipeline/`), o padrão de listagem/ficha/form dialog (`propostas/`), TanStack Query com `query-keys.ts`, e os tradutores de enum em `@/lib/labels` — que **já incluem** `translateProjectStatus`/`translateTaskStatus`/`translateTaskPriority` (nada a adicionar em labels).

O gancho **"criar Projeto ao ganhar"** está totalmente por implementar e foi deliberadamente adiado nas Fases 2 e 3 (sem TODO no código). A costura natural é `ProposalsService.moveDealToWon` ([proposals.service.ts:242-254](apps/api/src/modules/proposals/application/proposals.service.ts#L242-L254)) e/ou um novo ramo `if (targetStage.isWon)` em `DealsService.move` ([deals.service.ts:104](apps/api/src/modules/pipeline/application/deals.service.ts#L104), paralelo ao ramo `isLost` existente). Todos os dados de um Projeto (`clientId`, `title→name`, `serviceType` obrigatório) já vivem no `Deal` e na `Proposal`.

## Codebase Map

### Modelos Prisma já existentes (fonte de verdade)

**`Project`** — [schema.prisma:142-157](apps/api/prisma/schema.prisma#L142-L157): `clientId` (req), `proposalId?`, `name` (req), `serviceType` (req, `ServiceType`), `status ProjectStatus @default(ACTIVE)`, `startDate?`, `dueDate?`, `tasks Task[]`, `contracts Contract[]`. **Não tem `ownerId`** nem `position` — posse deriva do `Client`.

**`Task`** — [schema.prisma:159-176](apps/api/prisma/schema.prisma#L159-L176): `projectId` (req), `title`, `description?` (markdown), `status TaskStatus @default(BACKLOG)`, `priority TaskPriority @default(MEDIUM)`, `dueDate?`, `position Int`, `tags String[]`, `checklist Json?` (`[{text, done}]`), `completedAt?`, `@@index([projectId, status, position])`.

**Enums** — [schema.prisma:275-295](apps/api/prisma/schema.prisma#L275-L295): `ProjectStatus {ACTIVE,PAUSED,DONE,CANCELED}`, `TaskStatus {BACKLOG,TODO,IN_PROGRESS,REVIEW,DONE}`, `TaskPriority {LOW,MEDIUM,HIGH,URGENT}`.

> **Decisão de schema a validar no /spec:** os modelos existem, mas talvez falte um índice por prazo/atraso ou ajuste em `checklist`. O núcleo do CRUD não exige migration; um índice extra para "Minhas demandas" (filtro por `dueDate`) pode ser adicionado.

### Arquivos a criar / alterar

| Arquivo | Papel | Relevância |
|---|---|---|
| `apps/api/src/modules/projects/` (novo) | Módulo backend Projetos+Tarefas | Núcleo da fase — não existe |
| `apps/api/src/app.module.ts` | Registrar `ProjectsModule` nos imports | `ScheduleModule.forRoot()` já é global ([app.module.ts:23](apps/api/src/app.module.ts#L23)) |
| `apps/api/ENDPOINTS.md` | Documentar todas as rotas novas | **Definition of Done** — mesmo commit |
| `apps/api/prisma/seed.ts` | (opcional) seed de demonstração | Fase 6 formaliza; útil aqui |
| `apps/api/src/modules/proposals/application/proposals.service.ts:242-254` | Gancho criar-Projeto-ao-aceitar | Costura de "criar Projeto ao ganhar" |
| `apps/api/src/modules/pipeline/application/deals.service.ts:93-113` | (alternativa) ramo `isWon` em `move` | Costura de "criar Projeto ao ganhar" |
| `apps/web/src/features/demandas/` (novo) | Feature frontend | Telas + Kanban |
| `apps/web/src/lib/query-keys.ts` | Adicionar blocos `projects`/`tasks` | Padrão TanStack Query |
| `apps/web/src/routes/router.tsx:37,44,45` | Trocar 3 placeholders por telas reais | `/demandas`, `/projetos/:id`, aba `projetos` do cliente |
| `apps/web/src/lib/labels.ts` | **Nada** — já tem os 3 tradutores | [:54-77](apps/web/src/lib/labels.ts#L54-L77) |

### Padrões existentes a seguir

#### Backend — módulo em camadas (referência: `pipeline/`, `proposals/`)

Estrutura por agregado (Project + Task terão fatias verticais, como Deal + PipelineStage):
```
projects/
  projects.module.ts          → DI wiring
  domain/
    project.repository.ts      → PROJECT_REPOSITORY (Symbol) + interface + ProjectWithClient type
    task.repository.ts         → TASK_REPOSITORY (Symbol) + interface + TaskWithProject type
  application/
    projects.service.ts (+ .spec.ts)
    tasks.service.ts   (+ .spec.ts)
  infra/
    prisma-project.repository.ts
    prisma-task.repository.ts
  api/
    projects.controller.ts / tasks.controller.ts
    dto/ (create/update/list/move + class-validator pt-BR)
```
Regra CLAUDE.md: `application` depende só da **interface** de repositório (token DI); `PrismaService` só aparece em `infra/`. Para CRUD simples, o tipo `Prisma.XGetPayload<...>` serve de modelo direto (sem mapper).

**Pattern: token DI + interface no domain** — de [deal.repository.ts:3-8](apps/api/src/modules/pipeline/domain/deal.repository.ts#L3-L8):
```ts
export const DEAL_REPOSITORY = Symbol('DEAL_REPOSITORY');
export type DealWithClient = Prisma.DealGetPayload<{
  include: { client: { select: { id: true; name: true } } };
}>;
```

**Pattern: reindexação de posição no move (drag & drop)** — o algoritmo-chave a clonar (`stageId`→`status`), de [prisma-deal.repository.ts:74-127](apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts#L74-L127):
```ts
async move(dealId, toStageId, toPosition, patch) {
  return this.prisma.$transaction(async (tx) => {
    const deal = await tx.deal.findUniqueOrThrow({ where: { id: dealId } });
    const fromStageId = deal.stageId;
    const target = await tx.deal.findMany({
      where: { stageId: toStageId, id: { not: dealId } },
      orderBy: { position: 'asc' }, select: { id: true },
    });
    const clamped = Math.max(0, Math.min(toPosition, target.length));
    const orderedIds = [
      ...target.slice(0, clamped).map((d) => d.id),
      dealId,
      ...target.slice(clamped).map((d) => d.id),
    ];
    await tx.deal.update({ where: { id: dealId }, data: { stageId: toStageId, ...patch } });
    await Promise.all(orderedIds.map((id, i) =>
      tx.deal.update({ where: { id }, data: { position: i } })));
    if (fromStageId !== toStageId) {
      const from = await tx.deal.findMany({ where: { stageId: fromStageId }, orderBy: { position: 'asc' }, select: { id: true } });
      await Promise.all(from.map((d, i) => tx.deal.update({ where: { id: d.id }, data: { position: i } })));
    }
    return tx.deal.findUniqueOrThrow({ where: { id: dealId }, include: withClient });
  });
}
```
Notas: posição 0-based sem buracos; posição de origem reindexada ao trocar de coluna; `maxPositionInStage + 1` para nova posição no create ([deals.service.ts:55](apps/api/src/modules/pipeline/application/deals.service.ts#L55)).

**Pattern: board sem paginação vs lista paginada** — [deals.service.ts:42-44](apps/api/src/modules/pipeline/application/deals.service.ts#L42-L44) (`findAllForBoard` ordena por `[status/stageId, position]`) vs `list` que envelopa em `paginated(data, total, page, limit)` → `{ data, meta: { total, page, limit } }`. Helpers compartilhados em [shared/pagination.ts](apps/api/src/shared/pagination.ts) (`normalizePage`: default page=1/limit=20, MAX_LIMIT=100; `paginated`). Query DTO estende `PaginationQueryDto` ([shared/dto/pagination-query.dto.ts](apps/api/src/shared/dto/pagination-query.dto.ts), coerção com `@Type(() => Number)`).

**Pattern: derivação de posse (Task→Project→Client)** — Task não tem `ownerId`; posse deriva pela cadeia. Espelhar o guard privado `loadOwned` de [deals.service.ts:120-129](apps/api/src/modules/pipeline/application/deals.service.ts#L120-L129):
```ts
private async loadOwned(ownerId, id) {
  const deal = await this.repo.findById(id);
  if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
  await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
  return deal;
}
```
Para tasks: `TasksService.loadOwned` carrega a task → carrega o project → `clients.findOne(ownerId, project.clientId)`. `ownerId` vem de `@CurrentUserId()` (lê `req.user.sub`, [shared/current-user.decorator.ts](apps/api/src/modules/../shared/current-user.decorator.ts)) — primeiro parâmetro de todo método de controller.

**Pattern: erros** — `ConflictException` (409) ao excluir Project com Tasks vinculadas, espelhando o guard de estágio ([pipeline-stages.service.ts:78-86](apps/api/src/modules/pipeline/application/pipeline-stages.service.ts#L78-L86), `countDeals` → `prisma.deal.count`). `NotFoundException` (404) pt-BR. `UnprocessableEntityException` (422) se houver transição de status inválida (ver Open Questions sobre máquina de estados de tarefa).

**Pattern: DTO class-validator pt-BR** — de [create-deal.dto.ts](apps/api/src/modules/pipeline/api/dto/create-deal.dto.ts) e `move-deal.dto.ts`:
```ts
export class MoveDealDto {
  @IsUUID('4', { message: 'Estágio inválido.' }) stageId: string;
  @IsInt({ message: 'Posição inválida.' }) @Min(0, { message: 'Posição inválida.' }) position: number;
  @IsOptional() @IsString() lostReason?: string;
}
```
Update DTOs via `PartialType(OmitType(CreateX, [...imutáveis]))` de `@nestjs/mapped-types`. `MoveTaskDto` = `{ status: TaskStatus, position: number }`.

**Pattern: módulo + DI wiring** — de [pipeline.module.ts](apps/api/src/modules/pipeline/pipeline.module.ts):
```ts
@Module({
  imports: [ClientsModule],
  controllers: [ProjectsController, TasksController],
  providers: [
    ProjectsService, TasksService,
    { provide: PROJECT_REPOSITORY, useClass: PrismaProjectRepository },
    { provide: TASK_REPOSITORY, useClass: PrismaTaskRepository },
  ],
  exports: [ProjectsService], // consumido por Proposals/Pipeline (criar-ao-ganhar)
})
export class ProjectsModule {}
```
`PrismaModule` é `@Global()`, então repos só injetam `PrismaService` sem importar módulo.

**Pattern: @Cron (para "atrasadas" ou side-effects agendados)** — `ScheduleModule.forRoot()` já é global ([app.module.ts:23](apps/api/src/app.module.ts#L23)); basta declarar o provider `@Cron(CronExpression.EVERY_DAY_AT_3AM)`. Modelo em [proposals-expiration.job.ts](apps/api/src/modules/proposals/application/proposals-expiration.job.ts). **Nota:** "atraso" de demanda é **derivável no client** (`dueDate < hoje && status != DONE`), não precisa de cron — o cron da Fase 3 (expiração) mudava estado persistido; aqui o atraso é só visual. Confirmar no /spec.

**Pattern: testes unitários** — construtor direto (sem `Test.createTestingModule`), repo como `jest.Mocked<XRepository>` com todos os métodos `jest.fn()`, serviços-pares como mocks estruturais `as unknown as XService`, retornos Prisma com `mockResolvedValue({...} as never)`. Modelo em [proposals.service.spec.ts:11-39](apps/api/src/modules/proposals/application/proposals.service.spec.ts#L11-L39).

#### Frontend — feature isolada (referência: `pipeline/`, `propostas/`)

Estrutura: `features/demandas/{api/{projects.api.ts, tasks.api.ts, hooks.ts, types.ts, clients-lookup.api.ts}, components/, lib/{api-error.ts, project-format.ts, reindex-board.ts}, ProjetosListPage.tsx, ProjetoDetalhePage.tsx, ProjectFormDialog.tsx, TaskFormDialog.tsx}`. Páginas = default export; dialogs/components = named export.

**Pattern: query-keys** — adicionar em [query-keys.ts](apps/web/src/lib/query-keys.ts):
```ts
projects: {
  all: ['projects'] as const,
  list: (params: object) => ['projects', 'list', params] as const,
  detail: (id: string) => ['projects', 'detail', id] as const,
  byClient: (clientId: string) => ['projects', 'client', clientId] as const,
},
tasks: {
  all: ['tasks'] as const,
  board: (projectId: string) => ['tasks', 'board', projectId] as const,
  list: (params: object) => ['tasks', 'list', params] as const, // "Minhas demandas"
},
```

**Pattern: api layer + hooks** — objeto de wrappers axios `.then(r => r.data)` ([proposals.api.ts:6](apps/web/src/features/propostas/api/proposals.api.ts#L6)); hooks `useQuery`/`useMutation` com `invalidateAll(qc)` no `onSuccess` ([propostas/api/hooks.ts](apps/web/src/features/propostas/api/hooks.ts)). Invalidação cruzada quando criar-ao-ganhar dispara: invalidar `queryKeys.projects.all` além de deals (modelo: `useProposalAction` invalida `deals.all` no accept, [hooks.ts:71](apps/web/src/features/propostas/api/hooks.ts#L71)).

**Pattern: Kanban dnd-kit com update otimista + rollback** — clonar de `pipeline/` (`stageId`→`status`):
- Board [PipelineBoardPage.tsx](apps/web/src/features/pipeline/PipelineBoardPage.tsx): `DndContext` + `closestCorners`, `PointerSensor {distance: 8}`, agrupa por `Map<status, Task[]>`, `resolveTarget(overId, activeId)`, `handleDragEnd` com early-return se nada mudou, `DragOverlay`.
- Coluna [KanbanColumn.tsx](apps/web/src/features/pipeline/components/KanbanColumn.tsx): `useDroppable({id})` + `SortableContext verticalListSortingStrategy`.
- Card [SortableDealCard.tsx](apps/web/src/features/pipeline/components/SortableDealCard.tsx): `useSortable`, `CSS.Transform.toString`, `opacity: isDragging ? 0.4 : 1`.
- Mutation otimista [pipeline/api/hooks.ts:65](apps/web/src/features/pipeline/api/hooks.ts#L65): `onMutate` cancela query + `getQueryData`/`setQueryData` com `reindexBoard(...)`, `onError` faz rollback via `ctx.prev` + `toast.error`, `onSettled` invalida board.
- Helper puro imutável [reindex-board.ts:7](apps/web/src/features/pipeline/lib/reindex-board.ts#L7) — clonar renomeando `stageId`→`status`.

**Pattern: form RHF + Zod pt-BR + Select de enum** — de [DealFormDialog.tsx:27](apps/web/src/features/pipeline/DealFormDialog.tsx#L27): schema Zod com mensagens pt-BR inline, `zodResolver`, `useForm<Values>`, `useEffect([open, entity, reset])`, props `{open, onOpenChange, entity?, defaultClientId?}`. Dialog de `@/components/ui/dialog`; form com `id`, botão footer com `form="..."`. Campos com `@/components/ui/field` (`FieldLabel required` → asterisco `*` automático, **nunca à mão**). Selects de enum via `Controller` + `@/components/ui/select`, opções de `Object.keys(X_LABELS)`. Submit try/catch com `toast.success`/`toast.error(extractApiMessage(...))`. **Checklist de subtarefas**: usar `useFieldArray` + `useWatch` como [ItemsEditor.tsx](apps/web/src/features/propostas/components/ItemsEditor.tsx) faz com itens de proposta.

**Pattern: listagem** — de [PropostasListPage.tsx](apps/web/src/features/propostas/PropostasListPage.tsx): `useState` filtros+page, `LIMIT=20`, `@/components/ui/table` em `<div className="rounded-lg border">`, filtros de coluna via `ColumnFilter` local dirigido por `Object.keys(X_LABELS)`+`translateX`, `TableLink`, `<Badge variant={STATUS_BADGE[x]}>{translateX(x)}</Badge>` (mapa `STATUS_BADGE` local por página), skeleton no loading, `TableEmpty`, paginação "Anterior/Próxima". Ficha em [PropostaDetalhePage.tsx](apps/web/src/features/propostas/PropostaDetalhePage.tsx): `useParams`, loading skeleton, `Empty` fallback, `ConfirmDialog` para ações destrutivas.

**Pattern: tradutores de enum (JÁ EXISTEM)** — [labels.ts:54-77](apps/web/src/lib/labels.ts#L54-L77): `translateProjectStatus`, `translateTaskStatus`, `translateTaskPriority` já batem exatamente com o schema. **Nada a adicionar em labels.** Adicionar apenas `STATUS_BADGE`/`PRIORITY_BADGE` (variantes de cor) locais nas páginas.

**Pattern: axios + helpers** — `api` de [lib/api.ts](apps/web/src/lib/api.ts) (Bearer + refresh transparente). `extractApiMessage` copiado por feature ([propostas/lib/api-error.ts:3](apps/web/src/features/propostas/lib/api-error.ts#L3)). `clients-lookup.api.ts` cópia local do search de clientes (`GET /clients?search&limit=20`) para não importar interior de outra feature. `formatDate`/`formatDateTime` em [lib/format.ts](apps/web/src/lib/format.ts). Tipo `Paginated<T>` em [clientes/api/types.ts:54](apps/web/src/features/clientes/api/types.ts#L54).

### Fluxo de dados — "criar Projeto ao ganhar" (deferido)

Estado atual: **não há detecção de `isWon` no move de deals.** [DealsService.move](apps/api/src/modules/pipeline/application/deals.service.ts#L93-L113) só trata `isLost`. A transição para `isWon` hoje é disparada externamente por [ProposalsService.accept](apps/api/src/modules/proposals/application/proposals.service.ts#L178-L188) → [moveDealToWon](apps/api/src/modules/proposals/application/proposals.service.ts#L242-L254), que usa [PipelineStagesService.wonStage()](apps/api/src/modules/pipeline/application/pipeline-stages.service.ts#L39-L43) e move o deal — **sem criar projeto**.

Dados disponíveis para semear um Project (mapeamento direto): `Deal.clientId → Project.clientId`, `Deal.title → Project.name`, `Deal.serviceType → Project.serviceType` (todos obrigatórios já no Deal, [schema.prisma:81/85/86](apps/api/prisma/schema.prisma#L81-L86)); a `Proposal` também carrega `serviceType` ([:112](apps/api/prisma/schema.prisma#L112)) e pode fornecer `proposalId`.

Duas costuras possíveis (decisão para o /spec):
1. **Ramo `isWon` em `DealsService.move`** — paralelo ao `isLost` em [:104](apps/api/src/modules/pipeline/application/deals.service.ts#L104); cobre ganho manual (arrastar no Kanban) e via proposta. Exige `ProjectsService` injetado no `PipelineModule` (ou evento) — cuidado com dependência circular (Pipeline↔Projects).
2. **No `ProposalsService.accept`/`moveDealToWon`** — cobre só ganho via aceite de proposta; `ProposalsModule` já importa `PipelineModule`, adicionar `ProjectsModule`.

## Historical Context

- **Fase 2 (pipeline)** — [plano:57-58](specs/plans/2026-07-21-fase-2-pipeline.md#L57-L58): "Criar Projeto ao Ganhar — Projeto é Fase 4; na Fase 2 mover para Ganhou apenas move o deal (sem CTA/gancho)." Confirmado na pesquisa Fase 2 ([research:316-318](specs/research/2026-07-21-fase-2-pipeline.md#L316-L318)). Estágios são globais/single-tenant (sem `ownerId`).
- **Fase 3 (propostas)** — [plano:66-67](specs/plans/2026-07-23-fase-3-propostas.md#L66-L67): "Criar Projeto/Contrato no aceite — módulos das fases 4/5 não existem; o aceite apenas move o deal para isWon. Sem CTA placeholder." O helper `wonStage()` foi criado nessa fase. Se nenhum estágio for `isWon`, o accept marca `ACCEPTED` sem mover.
- **Fase 3 research** — [:363-367](specs/research/2026-07-23-fase-3-propostas.md#L363-L367): escopo "aceita sugere criar Projeto e Contrato" resolvido como opção (a): só marca `ACCEPTED`/`decidedAt` + move deal; Projeto (Fase 4) / Contrato (Fase 5) deferidos. FKs `Project.proposalId`/`Contract.proposalId`/`Activity.proposalId` são `SET NULL`.
- **Sem TODO no código** — a deferência existe só nos specs; nenhum `ConflictException`/comentário/placeholder de projeto foi deixado em `pipeline/` ou `proposals/`.

## Constraints & Considerations

- **pt-BR obrigatório** em toda mensagem visível (validação, toast, exceção, estado de UI) — CLAUDE.md raiz + de cada app. Enums sempre traduzidos via `@/lib/labels`.
- **Definition of Done backend**: toda rota nova em `apps/api/ENDPOINTS.md` no mesmo commit, formato fixo (`### MÉTODO /caminho` + Propósito/Auth/Body/Resposta/Erros/Handler). Rotas existentes vão até Proposals ([ENDPOINTS.md:339](apps/api/ENDPOINTS.md#L339)); adicionar seções `## Projects` e `## Tasks`.
- **Repository pattern**: nada de `PrismaService` em `application/`. Interface + token no `domain/`, impl em `infra/`.
- **Frontend**: sem modal-sobre-modal (primitivos `Dialog`/`AlertDialog` já cuidam via modal-stack); asterisco de obrigatório só via `FieldLabel required`; cores só via tokens do design system; cursor pointer em clicáveis (regra global).
- **Prefixo global** `/api/v1`; auth Bearer (global `JwtAuthGuard`), rotas públicas com `@Public()`.
- **Sem migration** para o núcleo (modelos já existem). Um índice por `dueDate` para "Minhas demandas" seria a única migration eventual.
- **Dependência circular** a evitar: se `PipelineModule` importar `ProjectsModule` para criar-ao-ganhar e `ProjectsModule` importar algo de pipeline, usar a costura via `ProposalsModule` ou `forwardRef`/evento. Decidir no /spec.

## Open Questions

1. **Máquina de estados de Task?** O move de deal valida transição só para `isLost` (motivo obrigatório). Tarefas têm transição livre entre colunas do Kanban, ou alguma regra (ex.: ao entrar em `DONE`, setar `completedAt`; ao sair, limpar)? Provável: só setar/limpar `completedAt` em DONE, sem 422 de transição.
2. **"Criar Projeto ao ganhar": automático ou sugestão (CTA)?** SPEC.md §3.4/ROADMAP dizem "sugere criar Projeto e Contrato". Criar automaticamente no backend ao mover para `isWon`, ou abrir um dialog no frontend sugerindo (com pré-preenchimento)? E qual costura (ramo em `deals.move` vs `proposals.accept`)?
3. **"Atrasadas" derivado no client ou cron?** Recomendação: derivar no client (`dueDate < hoje && status != DONE`), sem persistir estado — difere do cron de expiração da Fase 3. Confirmar.
4. **"Minhas demandas" — rota e escopo.** `/demandas` (placeholder atual) vira a lista geral cruzando projetos (`GET /tasks?priority=&dueBefore=&clientId=`), e `/projetos/:id` a ficha do projeto com Kanban? Precisa de uma rota `/projetos` (lista de projetos) além das existentes? Nav só tem "Demandas" ([nav.ts:35](apps/web/src/app/nav.ts#L35)).
5. **Checklist**: editar inline na ficha da task (toggle done) além do form? Persistência via `PATCH /tasks/:id` reescrevendo o Json inteiro (como `updateWithItems` de propostas) ou endpoint dedicado?
6. **Project precisa de `position`?** Não tem no schema. Se a lista de projetos não for Kanban (é tabela), não precisa. Confirmar que só Task tem board.

## Code References Index

- [apps/api/prisma/schema.prisma:142-176](apps/api/prisma/schema.prisma#L142-L176) — modelos Project + Task
- [apps/api/prisma/schema.prisma:275-295](apps/api/prisma/schema.prisma#L275-L295) — enums ProjectStatus/TaskStatus/TaskPriority
- [apps/api/src/modules/pipeline/domain/deal.repository.ts:3-8](apps/api/src/modules/pipeline/domain/deal.repository.ts#L3-L8) — token DI + tipo de domínio
- [apps/api/src/modules/pipeline/application/deals.service.ts:93-129](apps/api/src/modules/pipeline/application/deals.service.ts#L93-L129) — move + loadOwned (posse derivada)
- [apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts:74-127](apps/api/src/modules/pipeline/infra/prisma-deal.repository.ts#L74-L127) — reindexação de posição em $transaction
- [apps/api/src/modules/pipeline/application/pipeline-stages.service.ts:78-86](apps/api/src/modules/pipeline/application/pipeline-stages.service.ts#L78-L86) — 409 ao excluir com filhos (countDeals)
- [apps/api/src/modules/pipeline/pipeline.module.ts](apps/api/src/modules/pipeline/pipeline.module.ts) — DI wiring / imports / exports
- [apps/api/src/modules/proposals/application/proposals.service.ts:242-254](apps/api/src/modules/proposals/application/proposals.service.ts#L242-L254) — moveDealToWon (costura criar-ao-ganhar)
- [apps/api/src/modules/proposals/application/proposals.service.ts:178-188](apps/api/src/modules/proposals/application/proposals.service.ts#L178-L188) — accept
- [apps/api/src/modules/proposals/application/proposals-expiration.job.ts](apps/api/src/modules/proposals/application/proposals-expiration.job.ts) — modelo @Cron
- [apps/api/src/app.module.ts:23](apps/api/src/app.module.ts#L23) — ScheduleModule.forRoot() global
- [apps/api/src/shared/pagination.ts](apps/api/src/shared/pagination.ts) — normalizePage + paginated
- [apps/api/ENDPOINTS.md:339](apps/api/ENDPOINTS.md#L339) — fim da doc atual (adicionar Projects/Tasks)
- [apps/web/src/features/pipeline/PipelineBoardPage.tsx](apps/web/src/features/pipeline/PipelineBoardPage.tsx) — Kanban dnd-kit
- [apps/web/src/features/pipeline/api/hooks.ts:65](apps/web/src/features/pipeline/api/hooks.ts#L65) — mutation otimista + rollback
- [apps/web/src/features/pipeline/lib/reindex-board.ts:7](apps/web/src/features/pipeline/lib/reindex-board.ts#L7) — reindex imutável
- [apps/web/src/features/propostas/PropostasListPage.tsx](apps/web/src/features/propostas/PropostasListPage.tsx) — listagem+filtros+badge
- [apps/web/src/features/propostas/components/ItemsEditor.tsx](apps/web/src/features/propostas/components/ItemsEditor.tsx) — useFieldArray (modelo p/ checklist)
- [apps/web/src/lib/query-keys.ts](apps/web/src/lib/query-keys.ts) — adicionar projects/tasks
- [apps/web/src/lib/labels.ts:54-77](apps/web/src/lib/labels.ts#L54-L77) — tradutores já existentes
- [apps/web/src/routes/router.tsx:37,44,45](apps/web/src/routes/router.tsx#L37-L45) — 3 placeholders a substituir
- [apps/web/src/app/nav.ts:35](apps/web/src/app/nav.ts#L35) — item "Demandas"
- [specs/plans/2026-07-21-fase-2-pipeline.md:57-58](specs/plans/2026-07-21-fase-2-pipeline.md#L57-L58) — deferência criar-ao-ganhar
- [specs/plans/2026-07-23-fase-3-propostas.md:66-67](specs/plans/2026-07-23-fase-3-propostas.md#L66-L67) — deferência Projeto/Contrato no aceite
