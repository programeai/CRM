---
date: 2026-07-27T08:37:10-03:00
author: claude
source_prd: standalone
git_commit: e33f90b39740a4894f86d68126f92a064ed18ae7
branch: main
status: implemented
tags: [spec, test, e2e, auth, rls, prisma, ci]
---

# Spec: Cobertura e2e da API — smoke de auth e invariante de RLS

## Overview

A suíte da API tem 278 testes verdes e mesmo assim deixou passar um bug que
derrubava **todo** o `/auth/*` em produção: o getter `PrismaService.db`
devolvia um objeto sem os delegates de model, e login, registro, refresh, OAuth
e reset de senha respondiam 500 (corrigido em `2f218ee`, coberto em `e33f90b`).

A causa não foi falta de teste — foi falta de *tipo* de teste. Os 34 specs
mockam o Prisma, então nenhuma query do projeto jamais tocou um Postgres real
e nenhuma rota HTTP jamais foi exercida ponta a ponta. O `test/jest-e2e.json`
existe desde o scaffold do Nest e nunca recebeu um único `.e2e-spec.ts`.

Esta spec fecha a brecha em três fases: infraestrutura de e2e + smoke das rotas
públicas de auth (a que teria pego o bug), o invariante de isolamento por
`ownerId` (a que protege a promessa central do produto), e o portão no CI.

O provisionamento é barato porque as migrations já fazem tudo: a
`20260724040000_create_app_role` cria a role `crm_app` de forma idempotente com
os GRANTs, e cinco migrations criam as policies. Um banco de teste é
`CREATE DATABASE` + `prisma migrate deploy` — sem Testcontainers, sem
provisionamento manual.

## Current State

| Camada | Cobertura hoje |
|---|---|
| Regra de negócio (services) | 34 specs com Prisma mockado |
| `PrismaService` real | 1 spec (`prisma.service.spec.ts`), sem banco |
| Query ↔ schema real | nenhuma |
| RLS por `ownerId` (15 tabelas) | nenhuma — só mock |
| Rota HTTP ponta a ponta (22 controllers) | nenhuma |

Fatos do código que a implementação precisa respeitar:

- **Cadeia de guards global** (`app.module.ts`, ordem fixa): `ThrottlerGuard` →
  `JwtAuthGuard` → `AccessGuard` → `BillingGuard`, e o
  `OwnerContextInterceptor` depois deles.
- **Throttle** em `/auth/*`: `@Throttle({default:{limit:5,ttl:60000}})` em
  `register`, `login` e `reset-password`; `limit: 3` em `forgot-password`;
  global de 100/min. Um spec com 6 logins falha sozinho.
- **Captcha**: `TURNSTILE_SECRET_KEY` vazio desativa a verificação
  (`env.validation.ts`).
- **Billing**: `BILLING_ENABLED` default `false` → `BillingGuard` não bloqueia.
- **`NODE_ENV`** já aceita `'test'` no schema Joi.
- **Bootstrap** (`main.ts`): prefixo `api/v1`, `cookieParser`, `ValidationPipe`
  com `whitelist + forbidNonWhitelisted + transform`. O e2e precisa espelhar
  isso ou as rotas respondem 404 e os DTOs não validam.
- **Template de policy** (`20260724050000_enable_rls`): `USING` e `WITH CHECK`
  idênticos, `current_setting('app.owner_id', true)` com `missing_ok` → contexto
  ausente casa zero linhas (fail-closed). `FORCE ROW LEVEL SECURITY` sujeita o
  dono da tabela; `crm_user` bypassa por ser superuser.

## Desired End State

- `pnpm --filter api test:e2e` sobe o `AppModule` real contra um banco
  `crm_test` dedicado e roda dois specs: `auth.e2e-spec.ts` e `rls.e2e-spec.ts`.
- O banco de teste se provisiona sozinho no primeiro run (cria se não existir,
  aplica migrations) e é truncado entre os testes.
- Reverter a correção de `2f218ee` faz o `auth.e2e-spec.ts` falhar.
- Remover a policy de qualquer tabela faz o `rls.e2e-spec.ts` falhar.
- O CI roda os dois no mesmo job que já existe, com `services: postgres`, sem
  job novo e com ~30s a mais.
- O `apps/api/CLAUDE.md` passa a exigir spec sem mock para classe de
  infraestrutura.

## What We're NOT Doing

- **Round-trip por módulo de negócio** (POST + GET real em clients, deals,
  proposals…). É o nível 3 da proposta: alto valor, mas incremental — entra
  módulo a módulo conforme cada um for mexido, não num big bang.
- **Testes e2e do front** — o `apps/web` não tem suíte; o portão dele segue
  sendo o `tsc -b` do Dockerfile.
- **Testcontainers** — a stack já tem Postgres no compose e o CI tem
  `services:`. Uma dependência a mais não compraria nada.
- **Cobrir OAuth ponta a ponta** — exige simular Google/GitHub. Ficam de fora
  as rotas `/auth/oauth/*`; o smoke cobre `GET /auth/oauth/providers`, que é
  quem lê o banco.
- **Trocar os 34 specs unitários por e2e.** Mockar continua certo para regra de
  negócio; o e2e cobre o seam de infraestrutura, não substitui ninguém.
- **Testar envio real de e-mail** — sem `SMTP_HOST` o `MailService` só loga o
  link, e é isso que o teste de reset vai usar.

---

## Phase 1: Infraestrutura de e2e + smoke das rotas públicas de auth

### Goal

Subir o `AppModule` real contra um Postgres real e provar que o fluxo
registro → login → rota autenticada → refresh → logout funciona ponta a ponta.

### Changes

#### Configuração do Jest e2e

**Modify**: `apps/api/test/jest-e2e.json`

Adiciona `globalSetup` (provisiona o banco uma vez), `setupFiles` (carrega o
env antes dos imports) e `maxWorkers: 1` — os specs compartilham um único banco
e truncam entre testes, então paralelismo aqui só geraria corrida.

```json
{
  "moduleFileExtensions": ["js", "json", "ts"],
  "rootDir": ".",
  "testEnvironment": "node",
  "testRegex": ".e2e-spec.ts$",
  "transform": { "^.+\\.(t|j)s$": "ts-jest" },
  "globalSetup": "<rootDir>/global-setup.ts",
  "setupFiles": ["<rootDir>/carregar-env.ts"],
  "maxWorkers": 1,
  "testTimeout": 30000
}
```

**Create**: `apps/api/test/.env.test`

Env do e2e, versionado (não tem segredo real — é banco local e chave de teste).
O `.env` de dev **não** é reaproveitado: o e2e trunca tabelas, e apontar para
`crm_db` apagaria os dados de desenvolvimento.

```dotenv
NODE_ENV=test
# Banco DEDICADO ao e2e: o setup trunca tudo entre os testes. Nunca aponte para
# crm_db — apagaria os dados de desenvolvimento.
DATABASE_URL="postgresql://crm_user:crm_password@localhost:5435/crm_test?schema=public"
APP_DATABASE_URL="postgresql://crm_app:crm_app_password@localhost:5435/crm_test?schema=public"
JWT_ACCESS_SECRET=segredo-de-teste-com-mais-de-32-caracteres
JWT_REFRESH_SECRET=outro-segredo-de-teste-com-mais-de-32-chars
FRONTEND_URL="http://localhost:5173"
API_URL="http://localhost:3000"
# Vazio desativa o captcha (ver env.validation.ts) — sem isto o registro falha.
TURNSTILE_SECRET_KEY=
# Sem Stripe: o BillingGuard não pode bloquear rota autenticada no teste.
BILLING_ENABLED=false
REGISTRATION_ENABLED=true
# Sem SMTP o MailService só loga o link do reset, que é o que o spec consome.
SMTP_HOST=
```

**Create**: `apps/api/test/carregar-env.ts`

Roda antes de qualquer import do app (`setupFiles`), então o `ConfigModule`
já encontra as variáveis. `override: true` porque o `.env` de dev pode estar
carregado no ambiente do shell.

```ts
import { config } from 'dotenv';
import { join } from 'node:path';

config({ path: join(__dirname, '.env.test'), override: true });
```

> `dotenv` já vem como dependência transitiva de `@nestjs/config`; se o
> `import` não resolver, adicione `dotenv` em `devDependencies` da API.

**Create**: `apps/api/test/global-setup.ts`

Provisiona `crm_test` uma vez por execução. Usa o `PrismaClient` já instalado
para o `CREATE DATABASE` — evita depender de `psql` no PATH, o que faz o mesmo
código funcionar no runner do CI e na máquina local.

```ts
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';

config({ path: join(__dirname, '.env.test'), override: true });

/** `CREATE DATABASE` não aceita bind param e não roda dentro de transação. */
async function garantirBanco(url: string, nome: string) {
  // Conecta no banco administrativo `postgres` para poder criar o outro.
  const admin = new PrismaClient({
    datasources: { db: { url: url.replace(`/${nome}`, '/postgres') } },
  });
  try {
    const existe = await admin.$queryRaw<{ um: number }[]>`
      SELECT 1 AS um FROM pg_database WHERE datname = ${nome}
    `;
    if (existe.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${nome}"`);
    }
  } finally {
    await admin.$disconnect();
  }
}

export default async function globalSetup() {
  const url = process.env.DATABASE_URL!;
  await garantirBanco(url, 'crm_test');
  // `migrate deploy` traz schema, role crm_app (idempotente) e as policies.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: join(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
```

#### Helpers compartilhados

**Create**: `apps/api/test/helpers/app.ts`

Espelha o bootstrap de `main.ts` — sem prefixo global as rotas respondem 404, e
sem o `ValidationPipe` os DTOs não validam. Helmet e CORS ficam de fora: são
política de borda, não afetam o comportamento testado.

```ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/**
 * Sobe o AppModule REAL. O ThrottlerGuard é o único substituído: `/auth/login`
 * é 5/min por IP e no teste todas as requisições saem do mesmo IP — o sexto
 * login falharia por 429, não pelo que o spec quer provar.
 */
export async function criarAppDeTeste(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideGuard(ThrottlerGuard)
    .useValue({ canActivate: () => true })
    .compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
```

> Se o `overrideGuard(ThrottlerGuard)` não pegar (o guard entra por
> `APP_GUARD: useClass`), o plano B é `.overrideProvider(ThrottlerModule)` ou
> subir o limite por env — resolver na implementação, não deixar 429 escapar
> como falha intermitente.

**Create**: `apps/api/test/helpers/banco.ts`

`TRUNCATE` com a lista de tabelas descoberta do `pg_tables`, para não precisar
editar este arquivo a cada model novo. Roda como `crm_user`, que bypassa RLS.

```ts
import { PrismaClient } from '@prisma/client';

let admin: PrismaClient | null = null;

/** Client privilegiado (crm_user) — bypassa RLS, usado para fixture e limpeza. */
export function clientAdmin(): PrismaClient {
  admin ??= new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL! } },
  });
  return admin;
}

/** Zera as tabelas entre testes. `_prisma_migrations` fica de fora. */
export async function limparBanco(): Promise<void> {
  const db = clientAdmin();
  const tabelas = await db.$queryRaw<{ nome: string }[]>`
    SELECT tablename AS nome FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  const lista = tabelas.map((t) => `"${t.nome}"`).join(', ');
  await db.$executeRawUnsafe(
    `TRUNCATE TABLE ${lista} RESTART IDENTITY CASCADE`,
  );
}

export async function fecharBanco(): Promise<void> {
  await admin?.$disconnect();
  admin = null;
}
```

**Create**: `apps/api/test/helpers/fixtures.ts`

Cria owner e colaborador direto pelo client admin — não pela API — para que o
fixture não dependa das mesmas rotas que estão sendo testadas.

```ts
import * as argon2 from 'argon2';
import { clientAdmin } from './banco';

export const SENHA_PADRAO = 'senha-de-teste-123';

/** Owner (User.ownerId nulo) com senha conhecida e convite já aceito. */
export async function criarOwner(email: string) {
  return clientAdmin().user.create({
    data: {
      email,
      name: `Owner ${email}`,
      passwordHash: await argon2.hash(SENHA_PADRAO),
      acceptedAt: new Date(),
    },
  });
}

/** Colaborador vinculado a um owner, com o papel informado. */
export async function criarColaborador(
  email: string,
  ownerId: string,
  roleId: string,
) {
  return clientAdmin().user.create({
    data: {
      email,
      name: `Colab ${email}`,
      passwordHash: await argon2.hash(SENHA_PADRAO),
      acceptedAt: new Date(),
      ownerId,
      roleId,
    },
  });
}
```

> Campos conferidos contra `prisma/schema.prisma`: `User` tem `ownerId`,
> `roleId`, `active` (default `true`) e `acceptedAt` — `passwordHash` é
> **opcional** no schema (conta OAuth ou convite pendente), então o fixture
> precisa preenchê-lo explicitamente, como acima.

#### O smoke de auth

**Create**: `apps/api/test/auth.e2e-spec.ts`

O spec que teria pego o bug. O caso do registro é o mais importante: ele exercita
`db.user.create` **e** `db.session.create` fora de transação — exatamente o
caminho que estava quebrado.

```ts
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner, SENHA_PADRAO } from './helpers/fixtures';

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(limparBanco);
  afterAll(async () => {
    await app.close();
    await fecharBanco();
  });

  const http = () => request(app.getHttpServer());

  it('registro cria conta e devolve token — toca db.user e db.session fora de transação', async () => {
    const resposta = await http()
      .post('/api/v1/auth/register')
      .send({
        email: 'novo@teste.local',
        name: 'Novo',
        password: SENHA_PADRAO,
      })
      .expect(201);

    expect(resposta.body.accessToken).toEqual(expect.any(String));
    // O cookie de refresh é httpOnly e vive em /api/v1/auth.
    expect(resposta.headers['set-cookie']).toBeDefined();
  });

  it('login devolve accessToken e cookie de refresh', async () => {
    await criarOwner('owner@teste.local');

    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO })
      .expect(201);

    expect(resposta.body.accessToken).toEqual(expect.any(String));
  });

  it('login com senha errada responde 401 em pt-BR', async () => {
    await criarOwner('owner@teste.local');

    const resposta = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: 'errada' })
      .expect(401);

    expect(resposta.body.message).toBe('Credenciais inválidas');
  });

  it('token do login abre rota autenticada (/auth/me)', async () => {
    await criarOwner('owner@teste.local');
    const { body } = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });

    const me = await http()
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    expect(me.body.email).toBe('owner@teste.local');
  });

  it('rota autenticada sem token responde 401', async () => {
    await http().get('/api/v1/auth/me').expect(401);
  });

  it('refresh rotaciona a sessão e devolve token novo', async () => {
    await criarOwner('owner@teste.local');
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });

    const cookie = login.headers['set-cookie'];
    const refresh = await http()
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(201);

    expect(refresh.body.accessToken).toEqual(expect.any(String));
  });

  it('logout revoga a sessão: o refresh anterior deixa de valer', async () => {
    await criarOwner('owner@teste.local');
    const login = await http()
      .post('/api/v1/auth/login')
      .send({ email: 'owner@teste.local', password: SENHA_PADRAO });
    const cookie = login.headers['set-cookie'];

    await http()
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .set('Cookie', cookie)
      .expect(201);

    await http().post('/api/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('colaborador desativado não entra, com mensagem própria', async () => {
    // Fixture: owner + colaborador com active=false.
    // Espera 401 e a mensagem "Seu acesso ao CRM foi desativado…".
  });
});
```

**Modify**: `apps/api/package.json`

O script `test:e2e` já existe e aponta para o config certo — verificar apenas
que segue `jest --config ./test/jest-e2e.json`. Adicionar atalho de conveniência:

```json
"test:e2e:watch": "jest --config ./test/jest-e2e.json --watch"
```

### Success Criteria

#### Automated Verification
- [x] `docker compose up -d` — Postgres de pé em `localhost:5435`
- [x] `pnpm --filter api test:e2e` — os specs de auth passam do zero, criando `crm_test` sozinhos
- [x] `pnpm --filter api test:e2e` de novo — passa na segunda execução (prova que o truncate isola)
- [x] `pnpm --filter api test` — os 278 unitários seguem verdes e não ficaram mais lentos
- [x] `pnpm --filter api exec eslint test/` — sem erro
- [x] **Teste do teste**: revertendo `db` para `?? this` em `prisma.service.ts`, o `auth.e2e-spec.ts` falha em registro/login/refresh (5/8 falharam); restaurado

#### Manual Verification
- [ ] `psql -h localhost -p 5435 -U crm_user -d crm_db -c '\dt'` — o banco de **desenvolvimento** continua com os dados do seed intactos
- [ ] O log do e2e não vaza segredo (sem hash, token ou cookie nas linhas)

**⏸ PAUSE**: após a verificação automática passar, confirmar os itens manuais antes da Fase 2.

---

## Phase 2: Invariante de isolamento por `ownerId`

### Goal

Transformar a promessa central do produto — um owner nunca lê nem escreve dado
de outro — em teste executável, nas três camadas em que ela pode quebrar:
policy no banco, contexto no request e papel do colaborador.

### Changes

**Create**: `apps/api/test/rls.e2e-spec.ts`

```ts
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { criarAppDeTeste } from './helpers/app';
import { clientAdmin, limparBanco, fecharBanco } from './helpers/banco';
import { criarOwner, SENHA_PADRAO } from './helpers/fixtures';

describe('Isolamento por ownerId (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await criarAppDeTeste();
  });
  beforeEach(limparBanco);
  afterAll(async () => {
    await app.close();
    await fecharBanco();
  });

  const http = () => request(app.getHttpServer());

  async function logar(email: string): Promise<string> {
    const { body } = await http()
      .post('/api/v1/auth/login')
      .send({ email, password: SENHA_PADRAO });
    return body.accessToken as string;
  }

  // -------------------------------------------------------------------------
  // Camada 1: a policy em si, sem passar pela API.
  // -------------------------------------------------------------------------
  describe('policy no banco', () => {
    it('toda tabela com ownerId tem RLS ligado, forçado e com policy', async () => {
      // Meta-teste: tabela nova com ownerId e sem policy quebra AQUI, não em
      // produção. `User` é a única exceção legítima — tem ownerId (vínculo do
      // colaborador) mas fica fora do RLS de propósito, porque o login precisa
      // buscar por e-mail antes de existir contexto de owner
      // (ver 20260724050000_enable_rls). Query validada contra o banco real:
      // sem o filtro de `User` ela acusa falso positivo no primeiro run.
      const desprotegidas = await clientAdmin().$queryRaw<{ nome: string }[]>`
        SELECT c.relname AS nome
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND c.relname <> 'User'
          AND EXISTS (
            SELECT 1 FROM information_schema.columns col
            WHERE col.table_schema = 'public'
              AND col.table_name = c.relname
              AND col.column_name = 'ownerId'
          )
          AND (
            NOT c.relrowsecurity
            OR NOT c.relforcerowsecurity
            OR NOT EXISTS (
              SELECT 1 FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname
            )
          )
      `;
      expect(desprotegidas).toEqual([]);
    });

    it('as 15 tabelas protegidas hoje continuam protegidas', async () => {
      // Contagem-âncora: pega remoção acidental de policy numa migration.
      // Subir este número junto com a migration que adiciona a tabela nova é
      // parte do trabalho — é o momento de perguntar se ela precisa de RLS.
      const [{ total }] = await clientAdmin().$queryRaw<{ total: bigint }[]>`
        SELECT count(*) AS total FROM pg_policies WHERE schemaname = 'public'
      `;
      expect(Number(total)).toBe(15);
    });

    it('crm_app sem app.owner_id definido não enxerga linha nenhuma (fail-closed)', async () => {
      const owner = await criarOwner('a@teste.local');
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: owner.id },
      });

      // Conexão como crm_app SEM setar o GUC — é o cenário de bug que a
      // policy precisa fechar sozinha.
      const app_ = new PrismaClient({
        datasources: { db: { url: process.env.APP_DATABASE_URL! } },
      });
      try {
        await expect(app_.client.findMany()).resolves.toEqual([]);
      } finally {
        await app_.$disconnect();
      }
    });
  });

  // -------------------------------------------------------------------------
  // Camada 2: pela API, com dois owners de verdade.
  // -------------------------------------------------------------------------
  describe('owner não alcança dado de outro owner', () => {
    let clienteDoB: { id: string };

    beforeEach(async () => {
      const a = await criarOwner('a@teste.local');
      const b = await criarOwner('b@teste.local');
      await clientAdmin().client.create({
        data: { name: 'Cliente do A', ownerId: a.id },
      });
      clienteDoB = await clientAdmin().client.create({
        data: { name: 'Cliente do B', ownerId: b.id },
      });
    });

    it('a listagem devolve só os próprios clientes', async () => {
      const token = await logar('a@teste.local');
      // Shape do ENDPOINTS.md: `{ data: Client[], meta: { total, page, limit } }`.
      const { body } = await http()
        .get('/api/v1/clients')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(body.data.map((c: { name: string }) => c.name)).toEqual([
        'Cliente do A',
      ]);
      expect(body.meta.total).toBe(1);
    });

    it('ler cliente do outro owner responde 404, não 403', async () => {
      // 404 e não 403: com RLS a linha é INVISÍVEL, não proibida — e o 404 é o
      // que evita confirmar a existência do registro alheio.
      const token = await logar('a@teste.local');
      const resposta = await http()
        .get(`/api/v1/clients/${clienteDoB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      expect(resposta.body.message).toBe('Cliente não encontrado.');
    });

    it('editar cliente do outro owner responde 404 e não altera a linha', async () => {
      const token = await logar('a@teste.local');
      await http()
        .patch(`/api/v1/clients/${clienteDoB.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Invadido' })
        .expect(404);

      const depois = await clientAdmin().client.findUnique({
        where: { id: clienteDoB.id },
      });
      expect(depois?.name).toBe('Cliente do B');
    });

    it('arquivar cliente do outro owner responde 404 e não arquiva', async () => {
      // Arquivar é POST /:id/archive. O DELETE /:id é o EXPURGO — exige
      // `lixeira:expurgar` e que o registro já esteja arquivado, então não
      // serve para provar isolamento (o 404 poderia vir do 422/403).
      const token = await logar('a@teste.local');
      await http()
        .post(`/api/v1/clients/${clienteDoB.id}/archive`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);

      const depois = await clientAdmin().client.findUnique({
        where: { id: clienteDoB.id },
      });
      expect(depois?.archivedAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Camada 3: colaborador usa o ownerId do OWNER, não o dele.
  // -------------------------------------------------------------------------
  describe('colaborador enxerga os dados do owner que o convidou', () => {
    it('lista os clientes do owner, não os próprios', async () => {
      // Fixture: owner A + Role + colaborador de A com permissão de ver cliente.
      // Espera: GET /clients autenticado como colaborador devolve "Cliente do A".
      // É o caso que prova que o GUC recebe req.access.ownerId e não o user.sub.
    });

    it('colaborador de A não alcança dado de B', async () => {
      // Mesmo fixture, com um cliente de B: espera 404.
    });
  });
});
```

> Os dois últimos casos ficam esboçados de propósito: dependem do shape exato de
> `Role.permissions` e do catálogo em `shared/permissions.ts`. Preencher na
> implementação lendo o `access.service.ts`, sem inventar chave de permissão.

> Caminhos, verbos e shapes acima já conferidos contra `ENDPOINTS.md`:
> `GET /clients` → `{ data, meta }`; arquivar é `POST /clients/:id/archive`;
> `DELETE /clients/:id` é expurgo (`lixeira:expurgar` + já arquivado). As
> mensagens de erro asseridas são as literais do contrato, em pt-BR.
>
> Atenção a um detalhe do contrato ao estender para outros módulos: sem a
> permissão `cliente:ver_todos`, a listagem já filtra por responsável. Owner tem
> todas as permissões, então o caso do owner é limpo — mas o caso do
> colaborador precisa de papel com `ver_todos`, senão o teste passa pelo motivo
> errado (filtro de responsável, não RLS).

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test:e2e` — todos os casos de RLS passam
- [ ] **Teste do teste (policy)**: `DROP POLICY owner_isolation ON "Client"` no `crm_test` faz o meta-teste e os casos de vazamento falharem; recriar depois com `prisma migrate reset` — **bloqueado**: o `DROP POLICY` foi recusado pelo classificador de permissões do agente (ação destrutiva em banco); pendente de execução manual
- [x] **Teste do teste (contexto)**: trocar `req.access.ownerId` por `req.user.sub` no `owner-context.interceptor.ts` faz o caso do colaborador falhar (confirmado); revertido
- [x] `pnpm --filter api test` — unitários seguem verdes

#### Manual Verification
- [ ] Ler o `rls.e2e-spec.ts` e confirmar que cada caso corresponde a uma regra de `CLAUDE.md` → "Isolamento por owner"
- [ ] Confirmar que nenhum caso usa `clientAdmin()` para *ler* o resultado que deveria vir pela API (o admin bypassa RLS — só serve para fixture e para conferir efeito colateral)

**⏸ PAUSE**: confirmar antes da Fase 3.

---

## Phase 3: Portão no CI

### Goal

Fazer o e2e rodar a cada push na `main`, sem job novo e sem estourar minuto de
Actions.

### Changes

**Modify**: `.github/workflows/build.yml`

O job `construir` já instala pnpm, Node e gera o Prisma Client (linhas ~134-158).
Basta um `services: postgres` no job e um passo depois de "Testes da API".
Nada de job separado: outro job pagaria um segundo setup inteiro.

```yaml
jobs:
  construir:
    runs-on: ubuntu-latest

    # Postgres para o e2e. Sobe junto com o job — não custa minuto extra de
    # runner, só os ~20s de healthcheck na primeira vez.
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: crm_user
          POSTGRES_PASSWORD: crm_password
          POSTGRES_DB: crm_db
        ports:
          - 5435:5432
        options: >-
          --health-cmd "pg_isready -U crm_user"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5
```

E o passo, logo após `Testes da API`:

```yaml
      # O e2e sobe o AppModule real contra o Postgres do `services` acima. O
      # global-setup cria o banco crm_test e aplica as migrations sozinho.
      - name: Testes e2e da API
        if: steps.detectar.outputs.api == 'true'
        run: pnpm --filter api test:e2e
```

> A porta `5435:5432` mantém o `.env.test` funcionando igual local e no CI, sem
> ramificação por ambiente.

**Modify**: `apps/api/CLAUDE.md`

Nova regra na seção de testes (ou seção nova, se não existir), na altura da
regra do `ENDPOINTS.md`:

```markdown
## Testes — o que pode e o que não pode ser mockado

Mockar o Prisma nos specs de regra de negócio é o certo: eles testam a regra,
não o ORM. Mas **classe que fala com infraestrutura direto tem spec que a
instancia de verdade** — `PrismaService`, `PrismaAdminService` e os adapters de
e-mail e Stripe. Para o adapter em si, o mock testa o mock.

Além disso, todo seam de infraestrutura tem cobertura e2e (`test/*.e2e-spec.ts`,
`pnpm --filter api test:e2e`): as rotas públicas de auth e o isolamento por
`ownerId`. Rota nova que rode FORA da transação do `OwnerContextInterceptor`
(ou seja, marcada com `@Public()`) entra no `auth.e2e-spec.ts` no mesmo PR —
é o caminho que já quebrou uma vez com a suíte inteira verde.
```

**Modify**: `apps/api/README.md`

Uma linha na seção de testes com o pré-requisito (`docker compose up -d`) e o
comando `pnpm --filter api test:e2e`.

### Success Criteria

#### Automated Verification
- [ ] `act -j construir` ou push numa branch de teste — o workflow passa com o passo novo — **pendente**: `act` não está instalado neste ambiente e push para o GitHub é ação de saída que não foi autorizada; YAML validado localmente (`yaml.safe_load`), mas o run real do CI precisa ser confirmado por push
- [ ] O passo "Testes e2e da API" aparece verde no run
- [ ] Tempo total do job cresce ≤ 60s em relação ao run anterior

#### Manual Verification
- [ ] Abrir um PR com a correção de `2f218ee` revertida e confirmar que o CI **reprova**
- [ ] Confirmar que commit só de docs/spec segue barrado pelo `paths-ignore` (não gasta runner)

**⏸ PAUSE**: fim da spec.

---

## Testing Strategy

### Unit Tests
Sem mudança: os 34 specs existentes continuam mockando o Prisma. O
`prisma.service.spec.ts` (já em `e33f90b`) cobre o `PrismaService` real sem
banco, e continua sendo a rede mais rápida — ele falha em 0,4s, o e2e leva
dezenas de segundos.

### Integration Tests
Os dois `.e2e-spec.ts` desta spec. Fluxos cobertos: registro, login, login
inválido, rota autenticada, rota sem token, refresh, logout com revogação,
colaborador desativado; e o isolamento por `ownerId` em policy, leitura,
escrita, arquivamento e no caminho do colaborador.

### Migration & Rollback
Nada de migration nova. O banco `crm_test` é descartável: `prisma migrate reset`
apontando para ele reconstrói do zero. Rollback da spec inteira é apagar
`apps/api/test/` (menos o `jest-e2e.json`) e reverter os dois blocos do
`build.yml` — nenhum código de produção é tocado em nenhuma das três fases.

## Environment Considerations

- **CI/CD**: um `services: postgres` e um passo no job `construir` do
  `build.yml`. Sem job novo. O `deploy.yml` não muda.
- **Migrations**: nenhuma nova. O e2e consome as 17 existentes via
  `migrate deploy`.
- **Config/Secrets**: `apps/api/test/.env.test`, versionado — só tem credencial
  de banco local e chaves de teste. Nenhum segredo real entra ali; se algum dia
  precisar de um, vira `secrets` do Actions, não arquivo.
- **Multi-ambiente**: o `.env.test` aponta para `localhost:5435` tanto local
  (docker compose) quanto no CI (mapeamento do `services`), então não há
  ramificação por ambiente.
- **Banco local**: o e2e usa `crm_test`, nunca `crm_db`. O `TRUNCATE` do helper
  apagaria o seed de desenvolvimento se a URL estivesse errada — daí o comentário
  em caixa alta no `.env.test`.

## Dependencies & Risks

- **`overrideGuard(ThrottlerGuard)` pode não pegar**, porque o guard entra por
  `APP_GUARD: useClass`. Risco de 429 intermitente. Mitigação: validar logo no
  primeiro spec da Fase 1; plano B é subir o limite por env no `.env.test`.
- **Ordem dos guards é regra explícita** do `apps/api/CLAUDE.md` ("não altere").
  O helper `criarAppDeTeste` não pode reordenar nada — só substituir o
  Throttler.
- **`TRUNCATE` numa URL errada apaga o banco de desenvolvimento.** Mitigação: a
  URL vem só do `.env.test`, com aviso no arquivo. Vale considerar um guard no
  `limparBanco` que aborta se o nome do banco não terminar em `_test`.
- **Tempo de suíte**: e2e é ordens de magnitude mais lento que unitário. Manter
  os dois comandos separados (`test` e `test:e2e`) preserva o loop rápido de
  desenvolvimento.
- **`dotenv` como import direto** é hoje dependência transitiva de
  `@nestjs/config`. Se o resolve falhar, promover a `devDependencies` da API.
- **Fixture acoplado ao schema**: `criarOwner`/`criarColaborador` escrevem em
  `User` direto. Mudança de campo obrigatório em `User` quebra o fixture — é
  ruído aceitável, e falha barulhenta é melhor que fixture pela API.

## References

- Correção que originou a spec: `2f218ee` — `fix(prisma): corrige db devolvendo client sem os delegates de model`
- Spec unitária complementar: `e33f90b` — `apps/api/src/prisma/prisma.service.spec.ts`
- Regras de isolamento: `CLAUDE.md` → "Escopo de produto"; `apps/api/CLAUDE.md` → "Autorização"
- Template de policy: `apps/api/prisma/migrations/20260724050000_enable_rls/migration.sql`
- Role de aplicação: `apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql`
- Spec de RLS original: `specs/plans/2026-07-23-rls-por-ownerid.md`
- Contrato das rotas: `apps/api/ENDPOINTS.md`
