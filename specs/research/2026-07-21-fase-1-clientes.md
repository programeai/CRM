---
date: 2026-07-21T14:12:38+0000
researcher: claude
git_commit: 66c2291b54960fa510ed2c7aa6ac5640abe39eec
branch: main
topic: "Fase 1 — Clientes: CRUD de clientes e contatos, timeline de atividades e follow-ups"
tags: [research, clients, contacts, activities, backend, frontend]
status: complete
---

# Research: Fase 1 — Clientes

## Research Question
Fase 1 — Clientes: CRUD de clientes e contatos, timeline de atividades e follow-ups.
Base no SPEC.md §3.1 (Clientes), §3.5 (Atividades) e §5 (endpoints Clients/Contacts/Activities).
A Fase 0 (fundação + auth + schema Prisma completo) já está concluída.

## Summary

A Fase 1 é a **primeira spec de negócio** do CRM. A fundação está pronta e pode ser
assumida como estável: monorepo pnpm, Postgres 16 (Docker, porta host **5435**),
Prisma 6.19.3 com **todas as tabelas já migradas** (Client, Contact, Activity e enums
já existem — não é preciso migration nova, salvo mudança de modelo), seed com admin +
7 estágios de pipeline, e auth JWT completa com guard global. No frontend há Vite +
Tailwind v4 + shadcn (base **Base UI**, não Radix), React Router 7, TanStack Query e
axios com refresh automático; as rotas `/clientes` e `/clientes/:id` já existem como
`PlaceholderPage` e o item de menu "Clientes" já está no `nav.ts`.

O trabalho da Fase 1 é construir três recursos de backend (`clients`, `contacts`,
`activities`) e a feature de frontend correspondente (listagem, formulário e ficha do
cliente com timeline). Como é a primeira feature de negócio, **ela estabelece padrões
que não existem ainda**: paginação `{ data, meta }`, hooks de TanStack Query
(queryKeys/mutations/invalidação), e helpers de formatação (CPF/CNPJ, telefone, datas).

Há duas decisões de arquitetura que o `/spec` precisa fechar antes de implementar
(ver Open Questions): (1) o `apps/api/CLAUDE.md` exige **repository pattern em camadas**
(`domain`/`application`/`infra`/`api`) para módulos de negócio, mas permite Prisma direto
para CRUD simples — o código atual (`auth`/`users`) usa Prisma direto; (2) o SPEC.md §3.1
cita "endereço (opcional)" mas o schema Prisma **não tem** campos de endereço.

## Codebase Map

### Estado da fundação (pode ser assumido como PRONTO — Fase 0, `status: implemented`)
- Prisma 6.19.3, schema completo migrado (`20260721002325_init`), seed idempotente (admin `admin@crm.local` / `changeme123` + 7 estágios).
- Auth: JWT access (15 min) + refresh (7 dias, cookie httpOnly path `/api/v1/auth`), argon2, `JwtAuthGuard` **global** (toda rota autenticada por padrão), `@Public()`, throttler global (100 req/min).
- Frontend: React 19, TanStack Query, axios com refresh single-flight, layout protegido com sidebar; rotas `/clientes` e `/clientes/:id` como placeholder.

### Affected Files & Modules

**Backend — criar** (`apps/api/src/modules/`)

| File | Role | Relevância |
|------|------|-----------|
| `modules/clients/` (novo) | Módulo Clients: controller + service + DTOs (+ repo, se camadas) | Recurso principal |
| `modules/contacts/` (novo) | Contatos de cliente | `GET/POST /clients/:id/contacts`, `PATCH/DELETE /contacts/:id` |
| `modules/activities/` (novo) | Timeline de atividades / follow-ups | `GET/POST /activities`, `PATCH /activities/:id`, `POST /activities/:id/complete` |
| `apps/api/src/app.module.ts:11-19` | Registro de módulos nos `imports` | Adicionar os 3 novos módulos |
| `apps/api/ENDPOINTS.md` | Doc de endpoints (Definition of Done) | **Obrigatório** atualizar no mesmo commit |
| `apps/api/prisma/schema.prisma:22-56,210-225` | Models Client/Contact/Activity | Só muda se decidirmos adicionar endereço/índices/unique |

**Frontend — criar** (`apps/web/src/`)

| File | Role | Relevância |
|------|------|-----------|
| `features/clientes/` (novo) | Feature isolada: listagem, form, ficha, timeline | UI principal |
| `routes/router.tsx:7-33` | Trocar `PlaceholderPage` de `/clientes` e `/clientes/:id` | Rotas já registradas |
| `lib/api.ts` (existe) | Cliente axios — consumir daqui | baseURL `VITE_API_URL` = `http://localhost:3000/api/v1` |
| `lib/labels.ts:14-35,111-119` | Traduções já prontas | `translatePersonType/LeadSource/ClientStatus/ActivityType` |
| `lib/format.ts` (novo) | Helpers CPF/CNPJ, telefone, datas | **Não existem** — criar |
| `lib/query-keys.ts` (novo, opcional) | Convenção de queryKeys | Primeiro uso de Query no projeto |

### Existing Patterns to Follow

**Pattern: módulo NestJS (controller → service → Prisma direto)** — padrão vigente em `users`/`auth`.
```ts
// apps/api/src/modules/users/users.service.ts:6-18
constructor(private prisma: PrismaService) {}   // PrismaModule é @Global
findByEmail(email: string) {
  return this.prisma.user.findUnique({ where: { email } });
}
```
`PrismaModule` é `@Global()` (`apps/api/src/prisma/prisma.module.ts:1-6`) — injeção direta sem import.

**Pattern: controller REST + prefixo global** — `apps/api/src/main.ts:10` faz `setGlobalPrefix('api/v1')`; `@Controller('clients')` → `/api/v1/clients`.
```ts
// apps/api/src/modules/auth/auth.controller.ts (essência)
@Post('login')
login(@Body() dto: LoginDto) { ... }
// usuário atual: NÃO há @CurrentUser; ler req.user.sub manualmente
me(@Req() req: Request & { user: { sub: string } }) { return this.auth.me(req.user.sub); }
```

**Pattern: DTO com class-validator, mensagens pt-BR** — `apps/api/src/modules/auth/dto/login.dto.ts:1-10`.
```ts
export class LoginDto {
  @IsEmail({}, { message: 'E-mail inválido.' })
  email: string;
  @MinLength(6, { message: 'A senha deve ter no mínimo 6 caracteres.' })
  password: string;
}
```
`ValidationPipe` global com `whitelist: true, forbidNonWhitelisted: true, transform: true` (`apps/api/src/main.ts:12-18`) — **todo** campo aceito deve estar decorado, senão 400.

**Pattern: exceções nativas em pt-BR** — `throw new UnauthorizedException('Credenciais inválidas')` (`auth.service.ts:18`). Para Clientes: `NotFoundException('Cliente não encontrado.')`, `ConflictException(...)`.

**Pattern: campos sensíveis excluídos no service** — `const { passwordHash, ...safe } = user` (`auth.service.ts:37`). Para Client, avaliar não expor/aceitar `ownerId` do body.

**Pattern: teste unitário de service (Jest, mock manual)** — `apps/api/src/modules/auth/auth.service.spec.ts:1-87`. Instancia o service com `new Service(dep1Mock, ...)`, deps como `jest.Mocked<Pick<...>>`, descrições em pt-BR.

**Pattern: formulário RHF + Zod (pt-BR)** — `apps/web/src/features/auth/LoginPage.tsx:17-35`.
```ts
const schema = z.object({ email: z.string().email('E-mail inválido'), ... });
type Values = z.infer<typeof schema>;
useForm<Values>({ resolver: zodResolver(schema), defaultValues });
// campos: <Field data-invalid> <FieldLabel> <Input aria-invalid> <FieldError>
```

**Pattern: tradução de enum no frontend (obrigatório)** — `apps/web/src/lib/labels.ts`. Nunca renderizar enum cru. Já existem `translatePersonType` (14-18), `translateLeadSource` (20-27), `translateClientStatus` (29-35), `translateActivityType` (111-119).

**Componentes UI prontos** (`apps/web/src/components/ui/`): `Table`+`TableEmpty`+`TableLink` (listagem → detalhe), `Badge` (status), `ConfirmDialog` (arquivar), `Field`/`FieldError`/`Input`/`Select`, `SectionTabs` (sub-abas da ficha), `StatCard`, `Sheet`/`Dialog` (form em painel/modal), `Empty`, `Skeleton`, `sonner` (`toast.success/error` em pt-BR).

### Data Flow
Backend novo (proposto): `ClientsController` (`/api/v1/clients`, autenticado via guard global) → lê `ownerId` de `req.user.sub` → `ClientsService` → `PrismaService` (ou repositório, se camadas) → Postgres. Frontend: componente da feature → hook TanStack Query → `@/lib/api` (axios, injeta Bearer, refresh em 401) → API.

## External Research
Não foi necessária pesquisa externa — todas as libs (NestJS 11, Prisma 6, class-validator, TanStack Query 5, react-hook-form 7, Zod 4, shadcn/Base UI) já estão instaladas e em uso no repositório. Nenhuma dependência nova prevista, exceto (a decidir) uma lib de validação de CPF/CNPJ ou implementação própria.

## Historical Context
- `specs/research/2026-07-20-fase-0-fundacao.md` + `specs/plans/2026-07-20-fase-0-fundacao.md` (`status: implemented`) — fundação entregue.
- `specs/plans/2026-07-21-alinhar-ui-crm-ao-painel-admin.md` — alinhamento visual do shell (não é sobre dados; referência de estilo).
- **Não há PRD nem plano de Clientes** — esta é a primeira spec de negócio.
- Adaptações reais da Fase 0 vs SPEC original: Postgres na porta host **5435**; shadcn sobre **Base UI** (não Radix); forms usam `Field`/`FieldGroup` (não o wrapper `Form`/`FormField`); estrutura backend real é `src/modules/<nome>/` (não `src/clients/` flat do §6.1 do SPEC).

## Constraints & Considerations
- **pt-BR absoluto** (`CLAUDE.md:5-14`): toda mensagem ao usuário (validações Zod e class-validator, toasts, exceções da API, estados de UI) em português. Escrever direto, nunca traduzir depois.
- **Enums nunca crus na UI** (`CLAUDE.md:16-27`): sempre `@/lib/labels`.
- **Single-tenant** (`CLAUDE.md:50-52`): `ownerId` existe como preparação, sem RLS/tenant. Não introduzir multi-tenancy. Evitar over-engineering.
- **`ENDPOINTS.md` é Definition of Done** (`apps/api/CLAUDE.md`): toda rota nova/alterada refletida no mesmo commit, formato fixo (Propósito/Auth/Body/Resposta/Erros/Handler), pt-BR.
- **Comandos pnpm sempre da raiz com `--filter`** (`CLAUDE.md:33-36`): `pnpm --filter api ...`, `pnpm --filter web ...`. Banco via `docker compose up -d`.
- **Soft delete**: Client nunca é excluído — `POST /clients/:id/archive` seta `archivedAt`. O banco reforça: todas as FKs de filhos para `Client` usam `ON DELETE RESTRICT` (migration.sql:271-319).
- **Regra "único contato principal"** (`isPrimary`): sem constraint no banco — garantir em aplicação.
- **CPF/CNPJ validado quando informado** (SPEC §3.1): `document` é opcional; validar formato só se preenchido. Sem `@unique` no schema (conflito, se desejado, é checado manualmente).
- **Paginação**: não existe padrão — definir do zero. SPEC §5 fixa `?page=&limit=` → `{ data, meta: { total, page, limit } }`.
- **Índices**: só `Activity(clientId, createdAt)` existe hoje. Considerar índices para filtros de Client (status, ownerId) — implica migration.
- **Frontend é a primeira feature de Query**: estabelecer convenção de queryKeys/invalidação.

## Open Questions
Estas **precisam de decisão no `/spec`** antes de implementar:

1. **Arquitetura do módulo backend**: seguir o repository pattern em camadas (`domain`/`application`/`infra`/`api` + token DI) do `apps/api/CLAUDE.md`, ou o padrão vigente (service injeta `PrismaService` direto, como `users`)? O CLAUDE.md permite Prisma direto para "CRUD simples". Clients é majoritariamente CRUD, mas tem regras (arquivamento, contato principal único, validação de documento). **Recomendação a validar:** Prisma direto com regras no service, evitando over-engineering (alinhado ao princípio geral do CLAUDE.md raiz), e revisitar camadas nas fases com regra pesada (Propostas/Financeiro).

2. **Campos de endereço**: SPEC §3.1 cita "endereço (opcional, campos simples)", mas o model `Client` **não tem** esses campos. Adicionar ao schema (migration nova) na Fase 1, ou deixar fora do MVP da Fase 1? 

3. **Granularidade dos módulos**: `contacts` e `activities` como módulos próprios, ou submódulos/serviços dentro de `clients`? As rotas misturam níveis (`/clients/:id/contacts` aninhado, mas `/contacts/:id` e `/activities` no topo).

4. **Filtro por `ownerId`**: sendo single-tenant, as listagens devem filtrar por `ownerId` (derivado de `req.user.sub`) desde já, ou listar tudo? `ownerId` é `String` obrigatório sem FK — de onde vem na criação (sempre `req.user.sub`)?

5. **Unicidade de documento**: bloquear CPF/CNPJ duplicado (`ConflictException`) ou permitir? Hoje não há `@unique`.

6. **Escopo de UI da ficha do cliente**: a ficha (SPEC §3.1) prevê abas de propostas/projetos/contratos, que são de fases futuras. Confirmar que na Fase 1 a ficha traz apenas Dados + Contatos + Timeline de atividades (demais abas ficam como placeholder).

7. **Filtros/busca da listagem**: quais filtros na listagem de clientes na Fase 1 (busca por nome, status, origem, tags)? Ordenação padrão?

## Code References Index
- `apps/api/src/main.ts:10-23` — prefixo global `api/v1`, cookieParser, ValidationPipe (whitelist), CORS
- `apps/api/src/app.module.ts:11-22` — imports de módulos + guards globais (Throttler, JwtAuth)
- `apps/api/src/prisma/prisma.module.ts:1-6` — PrismaModule `@Global`
- `apps/api/src/prisma/prisma.service.ts:1-15` — PrismaService (connect/disconnect)
- `apps/api/src/modules/users/users.service.ts:6-18` — padrão service → Prisma direto
- `apps/api/src/modules/auth/auth.controller.ts` — controller, `req.user.sub`, `@Throttle`
- `apps/api/src/modules/auth/auth.service.ts:18,37` — exceção pt-BR, exclusão de campo sensível
- `apps/api/src/modules/auth/dto/login.dto.ts:1-10` — DTO class-validator pt-BR
- `apps/api/src/modules/auth/jwt-auth.guard.ts:23-41` — guard global, `req.user = { sub }`
- `apps/api/src/modules/auth/public.decorator.ts:1-3` — `@Public()`
- `apps/api/src/modules/auth/auth.service.spec.ts:1-87` — padrão de teste unitário
- `apps/api/prisma/schema.prisma:22-45` — model Client (ownerId, archivedAt, tags[])
- `apps/api/prisma/schema.prisma:47-56` — model Contact (isPrimary, clientId)
- `apps/api/prisma/schema.prisma:210-225` — model Activity (scheduledFor, completedAt, @@index clientId,createdAt)
- `apps/api/prisma/schema.prisma:228-246,313-320` — enums PersonType/LeadSource/ClientStatus/ActivityType
- `apps/api/prisma/seed.ts` — admin + 7 estágios (não cria clientes)
- `apps/web/src/lib/api.ts:6-52` — axios, baseURL, refresh single-flight em 401
- `apps/web/src/main.tsx:12-21` — QueryClientProvider, providers, Toaster
- `apps/web/src/features/auth/LoginPage.tsx:17-101` — padrão RHF + Zod + Field
- `apps/web/src/routes/router.tsx:7-33` — rotas (clientes já placeholder)
- `apps/web/src/app/nav.ts:25-43` — item de menu "Clientes" (grupo Comercial)
- `apps/web/src/lib/labels.ts:14-35,111-119` — traduções de enums de Cliente/Atividade
- `apps/web/src/components/ui/` — Table, TableLink, Badge, ConfirmDialog, Field, Select, SectionTabs, StatCard, Sheet, sonner
- `SPEC.md:61-78` — §3.1 Clientes (regras)
- `SPEC.md:146-150` — §3.5 Atividades/Timeline
- `SPEC.md:390-417` — §5 endpoints Clients/Contacts/Activities
- `CLAUDE.md` (raiz) — pt-BR, labels, single-tenant, pnpm
- `apps/api/CLAUDE.md` — modular monolith, repository pattern, ENDPOINTS.md
- `apps/web/CLAUDE.md` — camadas app/features/components/lib, Query como fonte de estado de servidor
