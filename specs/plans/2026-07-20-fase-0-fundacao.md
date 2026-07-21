---
date: 2026-07-20T00:00:00-03:00
author: claude
source_prd: specs/research/2026-07-20-fase-0-fundacao.md
git_commit: N/A (git inicializado na Phase 1 desta spec)
branch: N/A
status: approved
tags: [spec, monorepo, nestjs, prisma, auth, vite, react, shadcn, docker, pnpm]
---

# Spec: Fase 0 (Fundação) — CRM Solarz

## Overview
Implementar a fundação técnica do CRM Solarz: um monorepo pnpm com backend NestJS (`apps/api`) e frontend React/Vite (`apps/web`), banco PostgreSQL 16 via Docker, ORM Prisma com o schema de dados completo (SPEC.md §4) e migration inicial, autenticação JWT completa (access token 15 min + refresh token 7 dias via cookie HttpOnly, senha com argon2, guard global com decorator `@Public()`, rate limit no login), e o frontend base (Tailwind v4 + shadcn/ui, React Router com layout protegido sidebar/topbar, TanStack Query, React Hook Form + Zod, axios com refresh automático em 401).

A estratégia é construir de baixo para cima em 5 fases independentemente verificáveis: primeiro o scaffold do monorepo e a infra Docker, depois o banco/Prisma, depois a autenticação no backend, depois o scaffold do frontend, e por fim a integração ponta a ponta com login real funcionando. Ao final da Fase 0 o sistema não tem funcionalidades de negócio (clientes, propostas, etc. — fases 1+), mas está utilizável: dá para logar, navegar entre rotas protegidas e a fundação está pronta para receber os módulos de domínio.

## Current State
Repositório praticamente vazio: apenas `SPEC.md` (especificação de produto), `README.md` (vazio), e diretórios de skills (`.claude/skills`, `.agents/skills/shadcn`). **Não há git inicializado**, nem `apps/`, `docker-compose.yml` ou `package.json` raiz. Tudo é greenfield. Ver PRD `specs/research/2026-07-20-fase-0-fundacao.md` para detalhes de pesquisa.

## Desired End State
Ao final das 5 fases:
- `pnpm install` na raiz instala dependências dos dois apps.
- `docker compose up -d` sobe Postgres 16 saudável.
- `pnpm --filter api prisma migrate dev` aplica o schema completo; `pnpm --filter api prisma db seed` cria o usuário admin + 7 estágios do pipeline.
- `pnpm --filter api start:dev` sobe a API em `http://localhost:3000/api/v1` com guard global (todas as rotas exigem JWT exceto `POST /auth/login` e `POST /auth/refresh`).
- `pnpm --filter web dev` sobe o frontend em `http://localhost:5173`.
- Acessar qualquer rota sem login redireciona para `/login`. Login com `admin@crm.local` / senha do seed autentica, seta cookie HttpOnly de refresh, guarda o access token em memória e redireciona para `/` (dashboard placeholder). A navegação lateral (sidebar) leva a todas as rotas do SPEC.md §6.3 (páginas placeholder). Expiração do access token dispara refresh automático transparente via interceptor axios.
- `git log` mostra o histórico da Fase 0.

## What We're NOT Doing
- **Nenhuma funcionalidade de negócio**: CRUD de clientes, pipeline, propostas, projetos, demandas, atividades, financeiro e dashboard real são fases 1–6 do roadmap. As páginas criadas aqui são **placeholders** (só título + navegação).
- **Nenhum endpoint além de `/auth/*`**: os controllers de domínio não são criados nesta fase (só os módulos vazios podem ser gerados, mas sem rotas).
- **Sem testes E2E automatizados de UI** (Playwright/Cypress) — verificação de UI é manual nesta fase.
- **Sem CI/CD, sem deploy** — deploy é VPS/Docker (decidido), mas configuração de produção fica fora da Fase 0.
- **Sem backup pg_dump, sem rate limit global além do login** — mencionados no SPEC.md §6.4 mas não são pré-requisito da fundação.
- **Registro de usuário (signup)** — single-user; o usuário é criado via seed, não há endpoint de cadastro.

---

## Phase 1: Scaffold do monorepo + infra Docker

### Goal
Criar a estrutura do monorepo pnpm com os dois apps scaffolded (Nest e Vite) e o Postgres 16 rodando via Docker, com git inicializado.

### Changes

#### Raiz do monorepo

**Create**: `.gitignore` (raiz)
Ignorar node_modules, builds, envs e artefatos.
```gitignore
node_modules/
dist/
build/
.env
.env.local
*.log
.DS_Store
apps/*/dist/
apps/*/node_modules/
apps/api/prisma/*.db
```

**Create**: `package.json` (raiz)
Workspace root privado; scripts de conveniência para rodar ambos os apps.
```json
{
  "name": "crm",
  "private": true,
  "packageManager": "pnpm@9.15.0",
  "scripts": {
    "api": "pnpm --filter api",
    "web": "pnpm --filter web",
    "dev:api": "pnpm --filter api start:dev",
    "dev:web": "pnpm --filter web dev",
    "db:up": "docker compose up -d",
    "db:down": "docker compose down"
  }
}
```

**Create**: `pnpm-workspace.yaml`
```yaml
packages:
  - 'apps/*'
```

**Create**: `docker-compose.yml`
Postgres 16 com volume nomeado e healthcheck (PRD §5).
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

**Create**: `README.md` (sobrescreve o vazio)
Instruções mínimas de setup (pré-requisitos, subir banco, instalar, migrar, seed, rodar).
```markdown
# CRM Solarz

Monorepo: `apps/api` (NestJS) + `apps/web` (React/Vite). Ver `SPEC.md`.

## Setup dev
```bash
pnpm install
docker compose up -d            # Postgres 16 em localhost:5432
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
pnpm --filter api prisma migrate dev
pnpm --filter api prisma db seed
pnpm --filter api start:dev     # API em http://localhost:3000/api/v1
pnpm --filter web dev           # Web em http://localhost:5173
```
Login inicial: `admin@crm.local` / `changeme123` (trocar).
```

#### Backend scaffold

**Create**: `apps/api/` via Nest CLI
Gerar o projeto Nest dentro de `apps/api`. Comando (rodar da raiz):
```bash
pnpm dlx @nestjs/cli new apps/api --skip-git --package-manager pnpm
```
Depois ajustar `apps/api/package.json` para `"name": "api"` (o filtro pnpm casa pelo `name`).

#### Frontend scaffold

**Create**: `apps/web/` via Vite
```bash
pnpm create vite@latest apps/web -- --template react-ts
```
Ajustar `apps/web/package.json` para `"name": "web"`. Fixar React 18:
```bash
pnpm --filter web add react@18 react-dom@18
pnpm --filter web add -D @types/react@18 @types/react-dom@18
```

#### Git

**Init**: inicializar git na raiz e fazer o primeiro commit do scaffold.
```bash
git init
git add -A
git commit -m "chore: scaffold monorepo (api + web + docker)"
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm install` — instala sem erro na raiz
- [ ] `docker compose up -d && docker compose ps` — serviço `postgres` fica `healthy`
- [ ] `pnpm --filter api build` — Nest compila
- [ ] `pnpm --filter web build` — Vite/tsc compila
- [ ] `git log --oneline` — mostra o commit de scaffold

#### Manual Verification
- [ ] `apps/api` e `apps/web` existem com estrutura esperada e `name` = `api`/`web`
- [ ] `docker compose logs postgres` não mostra erros de inicialização
- [ ] `psql postgresql://crm_user:crm_password@localhost:5432/crm_db -c '\l'` (ou via cliente) conecta

**⏸ PAUSE**: Após verificação automática, parar para confirmação humana antes da Phase 2.

---

## Phase 2: Prisma + schema completo + migration + seed

### Goal
Configurar o Prisma no backend com o schema de dados completo (SPEC.md §4), validação de env, aplicar a migration inicial e um seed idempotente (usuário admin + 7 estágios do pipeline).

### Changes

#### Dependências
```bash
pnpm --filter api add @prisma/client @nestjs/config joi argon2
pnpm --filter api add -D prisma ts-node
```

#### Config de ambiente

**Create**: `apps/api/.env.example`
```
NODE_ENV=development
PORT=3000
DATABASE_URL="postgresql://crm_user:crm_password@localhost:5432/crm_db?schema=public"
JWT_ACCESS_SECRET="dev-access-secret-troque-em-producao-min-32-chars"
JWT_REFRESH_SECRET="dev-refresh-secret-troque-em-producao-min-32c"
JWT_ACCESS_TTL="15m"
JWT_REFRESH_TTL="7d"
FRONTEND_URL="http://localhost:5173"
COOKIE_DOMAIN="localhost"
```
`apps/api/.env` é cópia local (git-ignorado). Documentar no README que os secrets são de exemplo.

**Create**: `apps/api/src/config/env.validation.ts`
Schema Joi consumido pelo `ConfigModule`.
```typescript
import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().port().default(3000),
  DATABASE_URL: Joi.string().uri().required(),
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_TTL: Joi.string().default('7d'),
  FRONTEND_URL: Joi.string().uri().required(),
  COOKIE_DOMAIN: Joi.string().default('localhost'),
});
```

#### Prisma

**Create**: `apps/api/prisma/schema.prisma`
Schema completo — copiar **todos** os models e enums do SPEC.md §4 (User com `refreshTokenHash`, Client, Contact, PipelineStage, Deal, Proposal, ProposalItem, Project, Task, Contract, Payment, Activity) mais os enums (PersonType, LeadSource, ClientStatus, ServiceType, ProposalStatus, ProjectStatus, TaskStatus, TaskPriority, BillingType, ContractStatus, PaymentStatus, PaymentMethod, ActivityType). Incluir os índices listados no SPEC.md §4 Notas.
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// --- models: copiar integralmente de SPEC.md §4 ---
// User (com refreshTokenHash String?), Client, Contact, PipelineStage, Deal,
// Proposal, ProposalItem, Project, Task, Contract, Payment, Activity

// --- enums necessários (inferidos dos comentários do SPEC.md §4) ---
enum PersonType    { INDIVIDUAL COMPANY }
enum LeadSource    { REFERRAL PAID_TRAFFIC ORGANIC OUTBOUND OTHER }
enum ClientStatus  { LEAD ACTIVE INACTIVE LOST }
enum ServiceType   { SOFTWARE WEBSITE PAID_TRAFFIC }
enum ProposalStatus{ DRAFT SENT NEGOTIATING ACCEPTED REJECTED EXPIRED }
enum ProjectStatus { ACTIVE PAUSED DONE CANCELED }
enum TaskStatus    { BACKLOG TODO IN_PROGRESS REVIEW DONE }
enum TaskPriority  { LOW MEDIUM HIGH URGENT }
enum BillingType   { RECURRING INSTALLMENTS ONE_TIME }
enum ContractStatus{ ACTIVE PAUSED FINISHED CANCELED }
enum PaymentStatus { PENDING PAID OVERDUE CANCELED }
enum PaymentMethod { PIX TRANSFER BOLETO CARD CASH }
enum ActivityType  { NOTE CALL MEETING EMAIL WHATSAPP FOLLOW_UP }
```
**Nota de implementação**: o SPEC.md §4 declara relações por um lado (ex.: `Client.contacts Contact[]`) mas os models filhos (`Contact`, `Deal`, etc.) só têm o campo escalar `clientId` sem o campo de relação nem `@relation`. O Prisma **exige os dois lados da relação com `@relation` e a foreign key**. Ao transcrever, adicionar em cada model filho o campo de relação correspondente e o `@relation(fields: [...], references: [id])`, e adicionar `@@unique([name])` em `PipelineStage.name` (o seed faz `upsert` por `name`). Adicionar também os índices do SPEC.md §4 Notas via `@@index(...)`. `PipelineStage.name` precisa ser único para o `upsert` do seed funcionar.

**Create**: `apps/api/prisma/seed.ts`
Seed idempotente com argon2 e os 7 estágios do SPEC.md §3.2.
```typescript
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await argon2.hash('changeme123');
  await prisma.user.upsert({
    where: { email: 'admin@crm.local' },
    update: {},
    create: { email: 'admin@crm.local', name: 'Admin', passwordHash },
  });

  const stages = [
    { name: 'Novo lead',            isWon: false, isLost: false },
    { name: 'Contato feito',        isWon: false, isLost: false },
    { name: 'Reunião/Diagnóstico',  isWon: false, isLost: false },
    { name: 'Proposta enviada',     isWon: false, isLost: false },
    { name: 'Negociação',           isWon: false, isLost: false },
    { name: 'Ganhou',               isWon: true,  isLost: false },
    { name: 'Perdeu',               isWon: false, isLost: true  },
  ];
  for (const [order, s] of stages.entries()) {
    await prisma.pipelineStage.upsert({
      where: { name: s.name },
      update: {},
      create: { name: s.name, order, isWon: s.isWon, isLost: s.isLost },
    });
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
```

**Modify**: `apps/api/package.json`
Adicionar a config de seed do Prisma.
```json
{
  "prisma": { "seed": "ts-node prisma/seed.ts" }
}
```

#### PrismaService global

**Create**: `apps/api/src/prisma/prisma.service.ts`
```typescript
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
```

**Create**: `apps/api/src/prisma/prisma.module.ts`
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Registrar `ConfigModule` global com validação e `PrismaModule`.
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    PrismaModule,
  ],
})
export class AppModule {}
```

#### Migration
```bash
docker compose up -d
pnpm --filter api prisma migrate dev --name init
pnpm --filter api prisma db seed
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api prisma validate` — schema válido
- [ ] `pnpm --filter api prisma migrate dev --name init` — migration aplica sem erro
- [ ] `pnpm --filter api prisma db seed` — roda sem erro; roda **duas vezes** sem duplicar (idempotência)
- [ ] `pnpm --filter api build` — compila com o Prisma Client gerado

#### Manual Verification
- [ ] `pnpm --filter api prisma studio` mostra a tabela `User` com `admin@crm.local` e `PipelineStage` com 7 linhas na ordem correta
- [ ] `Ganhou` tem `isWon=true`, `Perdeu` tem `isLost=true`
- [ ] Tabelas de todos os models do SPEC.md §4 existem no banco

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 3.

---

## Phase 3: Autenticação no backend

### Goal
Implementar login/refresh/me com JWT (access 15 min + refresh 7 dias via cookie HttpOnly), argon2, guard global com `@Public()`, rate limit no login e CORS com credentials.

### Changes

#### Dependências
```bash
pnpm --filter api add @nestjs/jwt @nestjs/throttler cookie-parser
pnpm --filter api add -D @types/cookie-parser
```

#### Users

**Create**: `apps/api/src/users/users.service.ts`
Acesso ao User via Prisma.
```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
  setRefreshTokenHash(id: string, refreshTokenHash: string | null) {
    return this.prisma.user.update({ where: { id }, data: { refreshTokenHash } });
  }
}
```

**Create**: `apps/api/src/users/users.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
```

#### Auth — decorator, guard, dto

**Create**: `apps/api/src/auth/public.decorator.ts`
```typescript
import { SetMetadata } from '@nestjs/common';
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

**Create**: `apps/api/src/auth/jwt-auth.guard.ts`
```typescript
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(), context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    try {
      req.user = await this.jwt.verifyAsync(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
```

**Create**: `apps/api/src/auth/dto/login.dto.ts`
```typescript
import { Isemail, IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(6) password: string;
}
```
(Nota: usar `@IsEmail`, `@IsString`, `@MinLength` de `class-validator` — corrigir o import.)

**Create**: `apps/api/src/auth/auth.service.ts`
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private users: UsersService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.users.findByEmail(email);
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Credenciais inválidas');
    }
    return this.issueTokens(user.id);
  }

  async refresh(userId: string, refreshToken: string) {
    const user = await this.users.findById(userId);
    if (!user?.refreshTokenHash || !(await argon2.verify(user.refreshTokenHash, refreshToken))) {
      throw new UnauthorizedException();
    }
    return this.issueTokens(user.id);
  }

  async me(userId: string) {
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    const { passwordHash, refreshTokenHash, ...safe } = user;
    return safe;
  }

  async logout(userId: string) {
    await this.users.setRefreshTokenHash(userId, null);
  }

  private async issueTokens(sub: string) {
    const accessToken = await this.jwt.signAsync({ sub }, {
      secret: this.config.get('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_TTL'),
    });
    const refreshToken = await this.jwt.signAsync({ sub }, {
      secret: this.config.get('JWT_REFRESH_SECRET'),
      expiresIn: this.config.get('JWT_REFRESH_TTL'),
    });
    await this.users.setRefreshTokenHash(sub, await argon2.hash(refreshToken));
    return { accessToken, refreshToken };
  }
}
```

**Create**: `apps/api/src/auth/auth.controller.ts`
Login e refresh são `@Public()`; setam o refresh token em cookie HttpOnly e retornam o access token no corpo. Refresh lê o token do cookie e valida o userId decodificando o refresh JWT.
```typescript
import { Body, Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './public.decorator';

const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private auth: AuthService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.get('NODE_ENV') === 'production',
      domain: this.config.get('COOKIE_DOMAIN'),
      path: '/api/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refreshToken } = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Public()
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException();
    let sub: string;
    try {
      ({ sub } = await this.jwt.verifyAsync(token, { secret: this.config.get('JWT_REFRESH_SECRET') }));
    } catch {
      throw new UnauthorizedException();
    }
    const { accessToken, refreshToken } = await this.auth.refresh(sub, token);
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }

  @Get('me')
  me(@Req() req: Request & { user: { sub: string } }) {
    return this.auth.me(req.user.sub);
  }

  @Post('logout')
  async logout(@Req() req: Request & { user: { sub: string } }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.user.sub);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return { ok: true };
  }
}
```

**Create**: `apps/api/src/auth/auth.module.ts`
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [UsersModule, JwtModule.register({})],
  providers: [AuthService],
  controllers: [AuthController],
})
export class AuthModule {}
```

**Modify**: `apps/api/src/app.module.ts`
Adicionar `AuthModule`, `ThrottlerModule`, e registrar `JwtAuthGuard` + `ThrottlerGuard` como `APP_GUARD` (ordem: throttler antes do jwt para o login rate-limitar mesmo sem auth).
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validationSchema: envValidationSchema }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    PrismaModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

**Modify**: `apps/api/src/main.ts`
Prefixo `/api/v1`, `ValidationPipe` global, `cookie-parser`, CORS com credentials.
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: config.get('FRONTEND_URL'), credentials: true });
  await app.listen(config.get('PORT') ?? 3000);
}
bootstrap();
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter api build` — compila
- [ ] `pnpm --filter api lint` — sem erros de lint (se o Nest scaffold trouxe eslint)
- [ ] `curl -sX POST localhost:3000/api/v1/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@crm.local","password":"changeme123"}' -i` — retorna 201 com `accessToken` no corpo e `Set-Cookie: refresh_token=...; HttpOnly`
- [ ] `curl -sX POST localhost:3000/api/v1/auth/login ... -d '{"email":"admin@crm.local","password":"errada"}'` — retorna 401
- [ ] `curl -s localhost:3000/api/v1/auth/me` (sem token) — retorna 401
- [ ] `curl -s localhost:3000/api/v1/auth/me -H "Authorization: Bearer <accessToken>"` — retorna o usuário sem `passwordHash`/`refreshTokenHash`
- [ ] 6+ logins com senha errada em 1 min — o 6º retorna 429 (throttler)

#### Manual Verification
- [ ] Refresh: guardar o cookie do login, chamar `POST /auth/refresh` com o cookie → novo `accessToken` e novo `Set-Cookie`
- [ ] Logout zera `refreshTokenHash` (refresh subsequente com o cookie antigo dá 401)

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 4.

---

## Phase 4: Frontend base (Tailwind + shadcn + roteamento + query + axios)

### Goal
Configurar Tailwind v4 + shadcn/ui, React Router com layout protegido, TanStack Query, React Hook Form + Zod e o cliente axios com interceptor de refresh — sem ainda amarrar tudo à tela (isso é a Phase 5).

### Changes

#### Dependências e config
```bash
pnpm --filter web add tailwindcss @tailwindcss/vite
pnpm --filter web add react-router @tanstack/react-query axios react-hook-form zod @hookform/resolvers
pnpm --filter web add -D @types/node
```

**Modify**: `apps/web/vite.config.ts`
```typescript
import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
});
```

**Modify**: `apps/web/src/index.css`
```css
@import "tailwindcss";
```

**Modify**: `apps/web/tsconfig.app.json` (e `tsconfig.json`)
Adicionar `baseUrl` e `paths` para o alias `@/*`, manter `strict: true`.
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

**Create**: `apps/web/.env.example`
```
VITE_API_URL=http://localhost:3000/api/v1
```

#### shadcn init
```bash
pnpm --filter web dlx shadcn@latest init
pnpm --filter web dlx shadcn@latest add button card input label form sonner
```
Isso cria `components.json`, `src/lib/utils.ts` (`cn()`) e os componentes em `src/components/ui/`. Seguir as convenções de `.agents/skills/shadcn/` (tokens semânticos, `FieldGroup`/`Field` em forms, etc.).

#### Cliente HTTP + auth state

**Create**: `apps/web/src/lib/auth-store.ts`
Guarda o access token em memória (não localStorage) + helpers.
```typescript
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
export const setAccessToken = (t: string | null) => { accessToken = t; };
```

**Create**: `apps/web/src/lib/api.ts`
Axios com `withCredentials`, injeção do bearer e refresh automático em 401 com fila (PRD §4).
```typescript
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getAccessToken, setAccessToken } from './auth-store';

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let isRefreshing = false;
let queue: Array<(t: string | null) => void> = [];

api.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const isRefreshCall = original?.url?.includes('/auth/refresh');
    if (error.response?.status !== 401 || original._retry || isRefreshCall) {
      return Promise.reject(error);
    }
    original._retry = true;
    const retry = new Promise((resolve, reject) => {
      queue.push((t) => {
        if (!t) return reject(error);
        original.headers.Authorization = `Bearer ${t}`;
        resolve(api(original));
      });
    });
    if (!isRefreshing) {
      isRefreshing = true;
      try {
        const { data } = await api.post('/auth/refresh');
        setAccessToken(data.accessToken);
        queue.forEach((cb) => cb(data.accessToken));
      } catch (e) {
        setAccessToken(null);
        queue.forEach((cb) => cb(null));
        window.location.href = '/login';
      } finally {
        queue = [];
        isRefreshing = false;
      }
    }
    return retry;
  },
);
```

**Create**: `apps/web/src/lib/auth.tsx`
Contexto de auth: estado `isAuthenticated`, `login`, `logout`, e tentativa de refresh silencioso no boot.
```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from './api';
import { setAccessToken } from './auth-store';

type AuthCtx = { isAuthenticated: boolean; loading: boolean; login: (e: string, p: string) => Promise<void>; logout: () => Promise<void> };
const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isAuthenticated, setAuth] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.post('/auth/refresh')
      .then(({ data }) => { setAccessToken(data.accessToken); setAuth(true); })
      .catch(() => { setAccessToken(null); setAuth(false); })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setAuth(true);
  };
  const logout = async () => {
    await api.post('/auth/logout').catch(() => {});
    setAccessToken(null);
    setAuth(false);
  };
  return <Ctx.Provider value={{ isAuthenticated, loading, login, logout }}>{children}</Ctx.Provider>;
}
```

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter web build` — compila com os novos módulos e o alias `@`
- [ ] `pnpm --filter web dlx shadcn@latest add button` (idempotente) — não quebra `components.json`
- [ ] `test -f apps/web/src/lib/utils.ts && test -f apps/web/components.json` — shadcn inicializado

#### Manual Verification
- [ ] `pnpm --filter web dev` sobe sem erro; a página inicial do Vite renderiza com Tailwind aplicando estilos
- [ ] Um `<Button>` do shadcn renderiza estilizado numa página de teste

**⏸ PAUSE**: Parar para confirmação humana antes da Phase 5.

---

## Phase 5: Integração ponta a ponta (login + layout + rotas)

### Goal
Amarrar tudo: página de login funcional, layout protegido (sidebar/topbar) e todas as rotas do SPEC.md §6.3 como páginas placeholder — login real de ponta a ponta.

### Changes

#### Providers no boot

**Modify**: `apps/web/src/main.tsx`
Montar `QueryClientProvider`, `AuthProvider`, `RouterProvider` e `<Toaster/>` (sonner).
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth';
import { router } from '@/routes/router';
import './index.css';

const queryClient = new QueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
```

#### Layout e guarda de rota

**Create**: `apps/web/src/app/AppLayout.tsx`
Shell com sidebar (navegação para todas as rotas) + topbar (botão sair) + `<Outlet/>`. Usar tokens semânticos e componentes shadcn conforme convenção local.
```tsx
import { NavLink, Outlet } from 'react-router';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/auth';

const NAV = [
  { to: '/', label: 'Dashboard' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/pipeline', label: 'Pipeline' },
  { to: '/propostas', label: 'Propostas' },
  { to: '/demandas', label: 'Demandas' },
  { to: '/financeiro', label: 'Financeiro' },
  { to: '/financeiro/contratos', label: 'Contratos' },
];

export default function AppLayout() {
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r bg-sidebar p-4">
        <div className="mb-6 text-lg font-semibold">CRM Solarz</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rounded-md px-3 py-2 text-sm ${isActive ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <Button variant="ghost" size="sm" onClick={() => logout()}>Sair</Button>
        </header>
        <main className="flex-1 p-6"><Outlet /></main>
      </div>
    </div>
  );
}
```

**Create**: `apps/web/src/app/ProtectedRoute.tsx`
```tsx
import { Navigate, Outlet } from 'react-router';
import { useAuth } from '@/lib/auth';

export default function ProtectedRoute() {
  const { isAuthenticated, loading } = useAuth();
  if (loading) return <div className="grid min-h-screen place-items-center text-muted-foreground">Carregando…</div>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}
```

#### Páginas

**Create**: `apps/web/src/features/auth/LoginPage.tsx`
Form com RHF + Zod + componentes shadcn (`Form`/`Field`), chama `useAuth().login`, redireciona para `/` no sucesso, toast de erro.
```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/lib/auth';

const schema = z.object({ email: z.string().email('E-mail inválido'), password: z.string().min(6, 'Mínimo 6 caracteres') });
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } });

  const onSubmit = async (v: Values) => {
    try { await login(v.email, v.password); navigate('/', { replace: true }); }
    catch { toast.error('Credenciais inválidas'); }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader><CardTitle>Entrar no CRM Solarz</CardTitle></CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl><Input type="email" autoComplete="username" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Senha</FormLabel>
                  <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" disabled={form.formState.isSubmitting}>Entrar</Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Create**: `apps/web/src/features/_placeholder/PlaceholderPage.tsx`
Página genérica reutilizável para as rotas ainda não implementadas.
```tsx
export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted-foreground">Em breve — implementado em uma fase futura.</p>
    </div>
  );
}
```

**Create**: `apps/web/src/routes/router.tsx`
Todas as rotas do SPEC.md §6.3: `/login` pública, o restante sob `ProtectedRoute` + `AppLayout`.
```tsx
import { createBrowserRouter } from 'react-router';
import ProtectedRoute from '@/app/ProtectedRoute';
import AppLayout from '@/app/AppLayout';
import LoginPage from '@/features/auth/LoginPage';
import PlaceholderPage from '@/features/_placeholder/PlaceholderPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { path: '/', element: <PlaceholderPage title="Dashboard" /> },
          { path: '/clientes', element: <PlaceholderPage title="Clientes" /> },
          { path: '/clientes/:id', element: <PlaceholderPage title="Cliente" /> },
          { path: '/pipeline', element: <PlaceholderPage title="Pipeline" /> },
          { path: '/propostas', element: <PlaceholderPage title="Propostas" /> },
          { path: '/propostas/:id', element: <PlaceholderPage title="Proposta" /> },
          { path: '/projetos/:id', element: <PlaceholderPage title="Projeto" /> },
          { path: '/demandas', element: <PlaceholderPage title="Demandas" /> },
          { path: '/financeiro', element: <PlaceholderPage title="Financeiro — Recebimentos" /> },
          { path: '/financeiro/contratos', element: <PlaceholderPage title="Contratos" /> },
          { path: '/financeiro/contratos/:id', element: <PlaceholderPage title="Contrato" /> },
        ],
      },
    ],
  },
]);
```

**Delete/replace**: `apps/web/src/App.tsx` e `App.css`
Não são mais usados (o roteamento vive no `router.tsx`). Remover ou esvaziar para não conflitar; garantir que `main.tsx` não os importe.

### Success Criteria

#### Automated Verification
- [ ] `pnpm --filter web build` — compila o app completo com todas as rotas
- [ ] `pnpm --filter api start:dev` + `pnpm --filter web dev` — ambos sobem sem erro

#### Manual Verification
- [ ] Acessar `http://localhost:5173/` sem sessão → redireciona para `/login`
- [ ] Login com `admin@crm.local` / `changeme123` → entra, mostra o layout com sidebar e o Dashboard placeholder
- [ ] Navegar pela sidebar troca o conteúdo sem recarregar a página; a URL muda
- [ ] DevTools → Application → Cookies mostra `refresh_token` HttpOnly; o access token **não** está em localStorage
- [ ] Recarregar a página (F5) mantém a sessão (refresh silencioso no boot)
- [ ] "Sair" limpa a sessão e volta para `/login`
- [ ] Simular expiração: apagar o access token em memória (ou esperar 15 min) e navegar → uma chamada 401 dispara refresh automático e a navegação continua funcionando

**⏸ PAUSE**: Fim da Fase 0. Confirmar tudo antes de encerrar.

---

## Testing Strategy

### Unit Tests
- **Fase 3 (auth)**: teste unitário do `AuthService` — `login` rejeita senha errada (argon2.verify false → UnauthorizedException), `login` emite tokens e persiste hash do refresh, `refresh` rejeita quando `refreshTokenHash` é null ou não confere. Mockar `UsersService`, `JwtService`, `ConfigService`. Estes são os testes que o SPEC.md §6.2 pede para regras de negócio; nas fases futuras entram cálculo de total, versionamento, geração de parcelas, etc.
- Rodar com `pnpm --filter api test`.

### Integration Tests
- Nesta fase, a verificação de integração é feita via os comandos `curl` das Success Criteria da Phase 3 e a verificação manual E2E da Phase 5. Testes de integração automatizados (supertest) ficam como melhoria futura.

### Migration & Rollback
- **Aplicar**: `docker compose up -d` → `pnpm --filter api prisma migrate dev` → `pnpm --filter api prisma db seed`.
- **Rollback**: como é greenfield, rollback = `docker compose down -v` (apaga o volume) e recriar. Em ambientes futuros, `prisma migrate resolve`/nova migration reversa.

## Environment Considerations
- **CI/CD**: nenhuma pipeline nesta fase.
- **Migrations**: uma única migration `init` com o schema completo do SPEC.md §4.
- **Config/Secrets**: novas envs — `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`, `FRONTEND_URL`, `COOKIE_DOMAIN`, `PORT` (backend); `VITE_API_URL` (frontend). Documentadas nos `.env.example`.
- **Multi-environment**: `secure: true` no cookie apenas em produção (`NODE_ENV=production`); em dev o cookie não é `secure` (localhost sem HTTPS).

## Dependencies & Risks
- **pnpm + Nest/Vite**: edge cases de DI/symlink só ocorrem com lib compartilhada entre workspaces — não é o caso; se surgir, fallback é `node-linker: hoisted` no `.npmrc`.
- **Cookie cross-origin em dev**: front em `:5173`, API em `:3000` — mesma origem de host (`localhost`), portas diferentes. Cookie com `sameSite: 'lax'` + CORS `credentials: true` + axios `withCredentials: true` deve funcionar; se o navegador bloquear, avaliar `sameSite: 'none'` (exige `secure`, logo HTTPS) ou um proxy do Vite para `/api`. **Risco a validar na Phase 5 manual.**
- **Tailwind v4**: setup via `@tailwindcss/vite` é o atual; se o `shadcn init` esperar config v3, seguir o que o `shadcn@latest` gerar (ele detecta a versão do Tailwind).
- **`class-validator`/`class-transformer`**: o Nest scaffold já os traz; confirmar presença antes de usar DTOs (se ausentes, `pnpm --filter api add class-validator class-transformer`).

## References
- PRD: `specs/research/2026-07-20-fase-0-fundacao.md`
- Spec de produto: `SPEC.md` (§4 modelo de dados, §5 API, §6 arquitetura, §7 roadmap)
- Convenções de UI: `.agents/skills/shadcn/` (styling, forms, composição)
- Docs externas: NestJS Authentication/Guards/Rate-Limiting/CORS, Prisma NestJS guide, shadcn/ui Vite install, TanStack Query, React Router (links no PRD)
