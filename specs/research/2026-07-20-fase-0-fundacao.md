---
date: 2026-07-20T00:00:00-03:00
researcher: claude
git_commit: N/A (repositório ainda não inicializado com git)
branch: N/A
topic: "Fase 0 (Fundação) do CRM Solarz — monorepo, docker-compose, Nest+Prisma+migrations, Vite+Tailwind+shadcn, autenticação JWT completa, layout base"
tags: [research, monorepo, nestjs, prisma, auth, vite, react, shadcn, docker, pnpm]
status: complete
---

# Research: Fase 0 (Fundação) do CRM Solarz

## Research Question
Como implementar a Fase 0 do roadmap do CRM Solarz (ver `SPEC.md` §7): monorepo (`apps/api` NestJS + `apps/web` React), `docker-compose.yml` com PostgreSQL 16, Nest + Prisma + migrations, Vite + Tailwind + shadcn/ui, autenticação completa (login e-mail/senha, JWT access+refresh, guard global com `@Public()`, argon2), layout base com navegação. Confirmar/decidir: ORM (Prisma, assumido), UI kit (Tailwind+shadcn, assumido) e gerenciador de pacotes (pnpm vs npm, em aberto).

## Summary
O repositório está **totalmente vazio** — só existem `SPEC.md`, `README.md` (vazio) e diretórios de skills (`.claude/skills`, `.agents/skills/shadcn`). Não há `.git` inicializado. Não há nenhum código de app existente, então esta pesquisa é puramente externa (documentação oficial + convenções atuais de 2025/2026), exceto pelos arquivos locais do skill `shadcn` (`.agents/skills/shadcn/`), que já documentam convenções de componente/formulário/estilo a seguir no frontend.

Achados principais:
- **Gerenciador de pacotes**: pesquisa recomenda **pnpm workspaces** — mais rápido, menos disco, sem desvantagem real para este caso (2 apps sem lib compartilhada entre eles). Resolve a decisão em aberto nº 3 do `SPEC.md` §8.
- **ORM**: Prisma confirmado como boa escolha — bem documentado para NestJS, migrations (`migrate dev`/`migrate deploy`) e seed bem estabelecidos.
- **UI kit**: Tailwind (v4, via plugin `@tailwindcss/vite`) + shadcn/ui confirmado — as convenções já documentadas localmente em `.agents/skills/shadcn/` devem virar padrão de código do frontend desde o Phase 0.
- **Auth**: a doc oficial atual do NestJS recomenda `@nestjs/jwt` **sem** Passport como caminho principal (mais simples, menos dependências) — desvio pequeno em relação à menção de "JWT guard" do `SPEC.md`, mas dentro do espírito da spec (que não amarra a Passport). Refresh token deve ser validado via **hash salvo no banco** (não stateless puro) para permitir revogação — isso exige um campo novo no schema (`User.refreshTokenHash`) não previsto no `SPEC.md` original, sinalizado abaixo como decisão a confirmar no `/spec`.
- **Infra**: `docker-compose.yml` padrão com Postgres 16 + healthcheck; layout de app shell (sidebar/topbar) via rota-pai com `<Outlet />` no React Router, sem lib extra.

## Codebase Map

### Estado atual do repositório
| Caminho | Papel | Relevância |
|---|---|---|
| `SPEC.md` | Especificação de produto completa (visão, escopo, modelo de dados Prisma, API, arquitetura, roadmap) | Fonte única de verdade para todas as fases; §4 tem o schema Prisma completo, §5 as convenções de API, §6 a arquitetura técnica, §7 o roadmap |
| `README.md` | Vazio | Nenhuma |
| `.claude/skills/{prd,spec,code}/` | Skills do fluxo de trabalho (este documento é gerado pelo skill `prd`) | Meta — não é código do produto |
| `.agents/skills/shadcn/` | Documentação local do shadcn/ui (CLI, regras de styling/forms/composição) | **Deve ser seguida como padrão de código no frontend** — ver resumo abaixo |
| *(inexistente)* `apps/api/`, `apps/web/`, `docker-compose.yml`, `package.json` raiz | — | Tudo a ser criado do zero nesta fase |

Não há git inicializado (`git status` falha com "not a git repository"). O `/spec` deve considerar se a inicialização do git faz parte da Fase 0 (recomendado, para versionar desde o início).

### Convenções locais a seguir (`.agents/skills/shadcn/`)
Lidos integralmente: `SKILL.md`, `cli.md`, `rules/base-vs-radix.md`, `rules/styling.md`, `rules/composition.md`, `rules/forms.md`.

- **Styling**: nunca cor raw (`bg-blue-500`) — sempre token semântico (`bg-primary`, `text-muted-foreground`). `className` só para layout. Sem `space-x-*`/`space-y-*` → usar `flex ... gap-*`. `size-10` em vez de `w-10 h-10`. `truncate` em vez de `overflow-hidden text-ellipsis whitespace-nowrap`. Usar `cn()` de `@/lib/utils`.
- **Forms**: layout sempre com `FieldGroup`+`Field` (nunca `div` com `space-y-*`). `InputGroup` exige `InputGroupInput`/`InputGroupTextarea`. Conjuntos de 2–7 opções → `ToggleGroup`. Validação: `data-invalid` no `Field` + `aria-invalid` no controle.
- **Composição**: `Item` sempre dentro do seu `Group` correspondente. `Dialog`/`Sheet`/`Drawer` sempre com `Title` (`sr-only` se oculto). `Card` usa composição completa. Preferir componentes existentes (`Alert`, `Empty`, `sonner`/`toast()`, `Separator`, `Skeleton`, `Badge`) a markup customizado.
- **CLI**: sempre `npx shadcn@latest` (nunca copiar arquivos crus do GitHub); rodar `npx shadcn@latest info` antes de supor aliases/paths; template a usar é **`vite`** (SPA client-side, não framework/SSR).

## External Research

### 1. Gerenciador de pacotes — pnpm vs npm workspaces (decisão em aberto §8.3)
**Recomendação: pnpm workspaces.**
- Mais rápido (content-addressable store + hard links, ~2-3x vs npm), menor uso de disco, suporte a workspaces mais maduro (`--filter`, `workspace:*`).
- Riscos conhecidos (DI do Nest em monorepo pnpm — [nestjs/nest#13463](https://github.com/nestjs/nest/issues/13463); symlinks do Vite — [vitejs/vite#12743](https://github.com/vitejs/vite/issues/12743)) só se manifestam quando há **lib interna compartilhada** entre os apps via workspace — não é o caso aqui (`api` e `web` são independentes). Risco baixo.
- Só valeria npm se quisesse zero dependência extra — não compensa para este projeto.

Setup:
```yaml
# pnpm-workspace.yaml
packages:
  - 'apps/*'
```
```json
// package.json raiz
{ "name": "crm", "private": true, "packageManager": "pnpm@9.x" }
```
```bash
pnpm install
pnpm --filter api dev
pnpm --filter web dev
pnpm --filter api add @nestjs/config
```
Fontes: [pnpm Workspaces](https://pnpm.io/workspaces) · [pnpm-workspace.yaml reference](https://pnpm.io/pnpm-workspace_yaml) · [npm Workspaces](https://docs.npmjs.com/cli/v10/using-npm/workspaces)

### 2. Backend — estrutura NestJS + Prisma
Estrutura por domínio (não por camada), `PrismaModule` como módulo `@Global()` de infra:
```
apps/api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   └── env.validation.ts       # Joi ou class-validator
│   ├── prisma/
│   │   ├── prisma.module.ts        # @Global()
│   │   └── prisma.service.ts
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts      # POST /auth/login, /auth/refresh, GET /auth/me
│   │   ├── auth.service.ts
│   │   ├── jwt-auth.guard.ts       # APP_GUARD global
│   │   ├── public.decorator.ts     # @Public()
│   │   └── dto/login.dto.ts
│   ├── clients/  pipeline/  proposals/  projects/  activities/  dashboard/
│   │   └── (module.ts, controller.ts, service.ts, dto/)
│   └── users/
│       ├── users.module.ts
│       └── users.service.ts
└── prisma/
    ├── schema.prisma
    ├── migrations/
    └── seed.ts
```

**PrismaService** (padrão clássico, `@Global()`):
```typescript
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```
```typescript
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```
Regra crítica: **uma única instância global de PrismaClient** — múltiplas instâncias esgotam o pool de conexões (importante em hot-reload de dev).

**Migrations**:
```bash
npx prisma migrate dev --name init     # dev — cria+aplica, shadow DB, gera client
npx prisma migrate deploy              # prod/CI — só aplica pendentes, sem prompt
```

**Seed** (`prisma/seed.ts`), idempotente via `upsert`, cria usuário admin + estágios padrão do pipeline (conforme `SPEC.md` §6.4):
```typescript
const passwordHash = await argon2.hash('changeme123'); // usar argon2, NÃO bcrypt (ver §4)
await prisma.user.upsert({ where: { email: 'admin@crm.local' }, update: {}, create: { email: 'admin@crm.local', name: 'Admin', passwordHash } });
const stages = ['Novo lead', 'Contato feito', 'Reunião/Diagnóstico', 'Proposta enviada', 'Negociação', 'Ganhou', 'Perdeu'];
for (const [i, name] of stages.entries()) {
  await prisma.pipelineStage.upsert({ where: { name }, update: {}, create: { name, order: i, isWon: name === 'Ganhou', isLost: name === 'Perdeu' } });
}
```
Nomes de estágio conforme `SPEC.md` §3.2 (7 colunas, não 6 — a pesquisa externa usou nomes genéricos; usar os do SPEC).

**Config/env validation** — Joi (mais direto, doc oficial):
```typescript
ConfigModule.forRoot({
  isGlobal: true,
  validationSchema: Joi.object({
    NODE_ENV: Joi.string().valid('development','production','test').default('development'),
    PORT: Joi.number().port().default(3000),
    DATABASE_URL: Joi.string().uri().required(),
    JWT_ACCESS_SECRET: Joi.string().min(32).required(),
    JWT_REFRESH_SECRET: Joi.string().min(32).required(),
    FRONTEND_URL: Joi.string().uri().required(),
  }),
});
```

Fontes: [NestJS — Prisma recipe](https://docs.nestjs.com/recipes/prisma) · [Prisma — NestJS guide](https://www.prisma.io/docs/guides/nestjs) · [Prisma — Seeding](https://www.prisma.io/docs/orm/prisma-migrate/workflows/seeding) · [Prisma — dev/prod migration workflows](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production) · [Prisma — connection pool](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/databases-connections/connection-pool) · [NestJS — Configuration](https://docs.nestjs.com/techniques/configuration) · [NestJS — Validation](https://docs.nestjs.com/techniques/validation)

### 3. Backend — autenticação JWT
**Decisão recomendada: `@nestjs/jwt` sem Passport** (a doc oficial atual do NestJS apresenta isso como o guia principal; menos dependências, guard 100% explícito). Passport só compensaria com múltiplas estratégias (OAuth/SAML), não é o caso.

```bash
pnpm --filter api add @nestjs/jwt @nestjs/throttler argon2
```

Decorator `@Public()` + guard global:
```typescript
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService, private reflector: Reflector) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;
    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);
    if (!token) throw new UnauthorizedException();
    try {
      request['user'] = await this.jwtService.verifyAsync(token, { secret: process.env.JWT_ACCESS_SECRET });
    } catch { throw new UnauthorizedException(); }
    return true;
  }
  private extractToken(request: Request) {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
// app.module.ts: providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }]
```

**Refresh token — hash no banco (recomendado)**: refresh token é um JWT normal (secret **diferente** do access, 7d), mas o **hash** dele (argon2) fica salvo em `User.refreshTokenHash`. Permite revogar (logout real, invalidar todas as sessões). Custo extra mínimo (1 coluna + 1 query a mais no refresh).
⚠️ **Isso requer adicionar `refreshTokenHash String?` ao model `User`** — campo não presente no `SPEC.md` §4 original. Ver Open Questions.

```typescript
async login(email: string, pass: string) {
  const user = await this.usersService.findByEmail(email);
  if (!user || !(await argon2.verify(user.passwordHash, pass))) throw new UnauthorizedException();
  return this.issueTokens(user.id);
}
async refresh(userId: string, refreshToken: string) {
  const user = await this.usersService.findById(userId);
  const valid = user?.refreshTokenHash && (await argon2.verify(user.refreshTokenHash, refreshToken));
  if (!valid) throw new UnauthorizedException();
  return this.issueTokens(user.id);
}
private async issueTokens(sub: string) {
  const access_token = await this.jwtService.signAsync({ sub }, { secret: process.env.JWT_ACCESS_SECRET, expiresIn: '15m' });
  const refresh_token = await this.jwtService.signAsync({ sub }, { secret: process.env.JWT_REFRESH_SECRET, expiresIn: '7d' });
  await this.usersService.setRefreshTokenHash(sub, await argon2.hash(refresh_token));
  return { access_token, refresh_token };
}
```

**Hash de senha — argon2** (não bcrypt):
```typescript
const passwordHash = await argon2.hash(plainPassword); // argon2id por padrão
const isValid = await argon2.verify(passwordHash, plainPassword);
```
argon2id é memory-hard (recomendação OWASP para apps novas); bcrypt é só CPU-bound, mais barato de atacar com hardware especializado.

**Rate limit no login** (`@nestjs/throttler`):
```typescript
ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 10 }] }); // global
// no controller:
@Public() @Throttle({ default: { limit: 5, ttl: 60000 } }) @Post('login') login() {}
```

**CORS restrito**:
```typescript
app.enableCors({ origin: process.env.FRONTEND_URL, credentials: true });
```

Fontes: [NestJS — Authentication](https://docs.nestjs.com/security/authentication) · [NestJS — Guards](https://docs.nestjs.com/guards) · [NestJS — Rate Limiting](https://docs.nestjs.com/security/rate-limiting) · [NestJS — CORS](https://docs.nestjs.com/security/cors) · [npm argon2](https://www.npmjs.com/package/argon2) · [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html) · [wanago.io — refresh tokens NestJS](https://wanago.io/2020/09/21/api-nestjs-refresh-tokens-jwt/)

### 4. Frontend — Vite + React + Tailwind + shadcn/ui
```bash
pnpm create vite@latest apps/web -- --template react-ts
pnpm --filter web add react@18 react-dom@18
pnpm --filter web add -D @types/react@18 @types/react-dom@18
pnpm --filter web add tailwindcss @tailwindcss/vite
```
`vite.config.ts`:
```typescript
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```
`src/index.css`: `@import "tailwindcss";`
`tsconfig.app.json`: manter `"strict": true`, adicionar `"baseUrl": "."`, `"paths": {"@/*": ["./src/*"]}`.

Init shadcn (template **`vite`**, não framework mode):
```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add button card dialog form input select
```
Estrutura resultante: `src/components/ui/`, `src/lib/utils.ts` (`cn()`), `components.json`.

**React Router** (pacote unificado `react-router`, substitui `react-router-dom`):
```bash
pnpm --filter web add react-router
```
Rota protegida via layout-pai:
```tsx
function ProtectedLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <AppLayout />; // sidebar + topbar + <Outlet />
}
export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { element: <ProtectedLayout />, children: [
    { path: "/", element: <DashboardPage /> },
    { path: "/clientes", element: <ClientesPage /> },
    { path: "/clientes/:id", element: <ClienteDetailPage /> },
    { path: "/pipeline", element: <PipelinePage /> },
    { path: "/propostas", element: <PropostasPage /> },
    { path: "/propostas/:id", element: <PropostaDetailPage /> },
    { path: "/projetos/:id", element: <ProjetoDetailPage /> },
    { path: "/demandas", element: <DemandasPage /> },
    { path: "/financeiro", element: <FinanceiroPage /> },
    { path: "/financeiro/contratos", element: <ContratosPage /> },
    { path: "/financeiro/contratos/:id", element: <ContratoDetailPage /> },
  ]},
]);
```
`AppLayout.tsx` (sidebar+topbar fixos, conteúdo via `<Outlet />` — evita remontar shell a cada navegação):
```tsx
export default function AppLayout() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="app-main">
        <Topbar />
        <main className="app-content"><Outlet /></main>
      </div>
    </div>
  );
}
```

**TanStack Query v5**:
```bash
pnpm --filter web add @tanstack/react-query
```
```tsx
const queryClient = new QueryClient();
<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>
```

**React Hook Form + Zod**:
```bash
pnpm --filter web add react-hook-form zod @hookform/resolvers
```
Integrar com o componente `Form` do shadcn (`pnpm dlx shadcn@latest add form`), que já usa `FieldGroup`/`Field` internamente conforme convenção local.

**Axios — interceptor + refresh automático em 401 com fila**:
```bash
pnpm --filter web add axios
```
```typescript
export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL });
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
let isRefreshing = false;
let queue: Array<(token: string) => void> = [];
api.interceptors.response.use((res) => res, async (error) => {
  const original = error.config;
  if (error.response?.status === 401 && !original._retry) {
    original._retry = true;
    const retryPromise = new Promise((resolve) => {
      queue.push((newToken) => { original.headers.Authorization = `Bearer ${newToken}`; resolve(api(original)); });
    });
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const { data } = await axios.post('/auth/refresh', {}, { withCredentials: true });
        setAccessToken(data.access_token);
        queue.forEach((cb) => cb(data.access_token)); queue = [];
      } catch (e) {
        queue = []; logout();
        return Promise.reject(e);
      } finally { isRefreshing = false; }
    }
    return retryPromise;
  }
  return Promise.reject(error);
});
```
Ponto de atenção: refresh token idealmente em cookie **HttpOnly** (não `localStorage`) por segurança contra XSS — isso implica `credentials: true` no CORS do backend e `withCredentials: true` no axios. Ver Open Questions.

Fontes: [ui.shadcn.com/docs/installation/vite](https://ui.shadcn.com/docs/installation/vite) · [tailwindcss.com/docs/installation/using-vite](https://tailwindcss.com/docs/installation/using-vite) · [reactrouter.com/start/framework/route-module](https://reactrouter.com/start/framework/route-module) · [tanstack.com/query/latest](https://tanstack.com/query/latest/docs/framework/react/quick-start) · [react-hook-form.com/get-started](https://react-hook-form.com/get-started)

### 5. Infra — docker-compose + DATABASE_URL
```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: crm_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: crm_user
      POSTGRES_PASSWORD: crm_password
      POSTGRES_DB: crm_db
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crm_user -d crm_db"]
      interval: 5s
      timeout: 5s
      retries: 5
volumes:
  postgres_data:
```
```
DATABASE_URL="postgresql://crm_user:crm_password@localhost:5432/crm_db?schema=public"
```
Caracteres especiais em usuário/senha devem ser percent-encoded.

Fontes: [PostgreSQL Official Image](https://hub.docker.com/_/postgres) · [Prisma — connection URLs](https://www.prisma.io/docs/orm/reference/connection-urls)

## Historical Context
Nenhum — projeto greenfield, sem specs/decisões anteriores em `specs/`.

## Constraints & Considerations
- Repositório sem `.git` — recomenda-se `git init` como parte da Fase 0 antes do primeiro commit de scaffold.
- Uma única instância global de `PrismaClient` (via `PrismaModule` `@Global()`) — evitar recriar em hot-reload de dev.
- `billingDay` (Contract, fase futura) e outros campos financeiros não fazem parte da Fase 0 — mencionado aqui só para não esquecer que o schema completo do `SPEC.md` §4 deve ser criado de uma vez na migration inicial (`prisma migrate dev --name init`), mesmo que só `User` seja usado nesta fase, para evitar migrations incrementais dolorosas mais tarde. **A definir no /spec**: criar o schema completo (todos os models do §4) na migration inicial, ou só `User` + `PipelineStage` (necessários para login e seed) e o resto incrementalmente por fase?
- `argon2` (não `bcrypt`) deve ser usado consistentemente — um dos agentes de pesquisa sugeriu `bcrypt` no snippet de seed por hábito comunitário; **corrigido aqui para argon2**, conforme decisão já assumida no `SPEC.md` §6.2.
- Nomes dos 7 estágios do pipeline (seed) devem seguir exatamente o `SPEC.md` §3.2, não os nomes genéricos que apareceram na pesquisa externa.
- pnpm tem edge cases conhecidos de DI (Nest) e symlink (Vite) apenas quando há **lib compartilhada entre workspaces** — não se aplica aqui, mas vale reter como nota caso o projeto evolua para ter um pacote `packages/shared` de tipos comuns entre `api` e `web` (mencionado no `SPEC.md` §6.1 como `apps/web/src/types/`, hoje local a cada app, não compartilhado via workspace).

## Open Questions — RESOLVIDAS
Decisões tomadas com o usuário em 2026-07-20:

1. **Refresh token**: hash no banco (`User.refreshTokenHash`, argon2) — permite revogação/logout real. **Requer adicionar `refreshTokenHash String?` ao model `User` no `SPEC.md` §4** (feito).
2. **Entrega do refresh token**: cookie **HttpOnly** — requer CORS com `credentials: true` no backend e `withCredentials: true` no axios do frontend. `POST /auth/refresh` deve setar o cookie via `Set-Cookie`, não retornar o refresh token no corpo.
3. **Schema Prisma inicial**: **completo de uma vez** — a migration `init` cria todos os models do `SPEC.md` §4 (Client, Contact, PipelineStage, Deal, Proposal, ProposalItem, Project, Task, Contract, Payment, Activity), mesmo que só `User`/`PipelineStage` sejam exercitados pela Fase 0.
4. **Git**: `git init` + primeiro commit do scaffold faz parte da Fase 0.

## Code References Index
- `SPEC.md:199-230` — model `User` e `Client` (Prisma)
- `SPEC.md:242-249` — model `PipelineStage` (usado no seed)
- `SPEC.md:389-417` — convenções de API (§5) relevantes para `/auth/*`
- `SPEC.md:420-471` — arquitetura técnica completa (§6), estrutura de repositório, stack backend/frontend
- `SPEC.md:475-487` — roadmap, Fase 0 (§7)
- `SPEC.md:491-498` — decisões §8 (já atualizadas: deploy VPS/Docker, sem juros/multa, reajuste manual — decididas nesta sessão)
- `.agents/skills/shadcn/SKILL.md`, `cli.md`, `rules/*.md` — convenções de UI a seguir no frontend desde a Fase 0
