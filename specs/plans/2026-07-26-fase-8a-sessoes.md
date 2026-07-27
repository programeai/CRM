---
date: 2026-07-26T22:15:00-03:00
author: claude
source_prd: specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md
git_commit: 35421684362649ab861746eaf7c0fa8bc5932265
branch: main
status: implemented
tags: [spec, auth, sessoes, refresh-token, perfil]
---

# Spec: Fase 8A — Sessões múltiplas

## Overview

Hoje o CRM suporta **uma sessão por usuário**: o refresh token vigente é um único hash argon2 em `User.refreshTokenHash` ([schema.prisma:18](../../apps/api/prisma/schema.prisma#L18)). Entrar no celular derruba o desktop. Esta fase substitui esse campo por uma tabela `Session`, com uma linha por dispositivo, e dá ao usuário a lista das suas sessões ativas no perfil, com revogação individual ou em massa.

O gargalo não é a tabela — é o payload do refresh token. Hoje o JWT carrega apenas `{ sub }`, e o servidor descobre se ele vale comparando `argon2.verify` contra o hash único. Com N sessões e sem identificador de sessão no token, validar viraria N verificações argon2 por refresh, e argon2 é deliberadamente caro. A saída é embutir um **`sid`** (id da sessão) no payload: a validação passa a ser uma busca indexada por chave primária + **um** `verify`, independente do número de sessões.

A tabela nasce num ponto do sistema onde **não existe contexto de RLS**: login, refresh e aceite de convite são rotas `@Public()`, rodam fora da transação do [OwnerContextInterceptor](../../apps/api/src/prisma/owner-context.interceptor.ts#L36-L41) e tocam hoje só tabelas sem policy (`User`, `OAuthAccount`, `PasswordResetToken`). `Session` cai nesse mesmo grupo: **sem RLS**, com filtro explícito por `userId` no serviço.

## Current State

- `User.refreshTokenHash String?` — hash argon2 do refresh vigente, um por usuário.
- `AuthService.issueTokens(sub)` ([auth.service.ts:264-284](../../apps/api/src/modules/auth/auth.service.ts#L264-L284)) assina os dois JWTs com `{ sub }` e sobrescreve o hash.
- `AuthService.refresh(userId, token)` ([:207-225](../../apps/api/src/modules/auth/auth.service.ts#L207-L225)) faz `argon2.verify` contra o hash único e `assertActive`.
- **Quatro** pontos de escrita do hash no repositório inteiro:
  1. `UsersService.setRefreshTokenHash` ([users.service.ts:143-148](../../apps/api/src/modules/users/users.service.ts#L143-L148)) — chamado por `issueTokens`, `logout` e `resetPassword`;
  2. `AuthService.logout` ([:260-262](../../apps/api/src/modules/auth/auth.service.ts#L260-L262));
  3. `AuthService.resetPassword` ([:190](../../apps/api/src/modules/auth/auth.service.ts#L190));
  4. `PrismaCollaboratorRepository.revokeSession` ([prisma-collaborator.repository.ts:97-102](../../apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts#L97-L102)) — escreve `refreshTokenHash: null` direto.
- `setRefreshCookie` ([refresh-cookie.ts:14-27](../../apps/api/src/modules/auth/refresh-cookie.ts#L14-L27)) é o ponto único do cookie, com `maxAge` de 7 dias fixo.
- `req.ip` e `user-agent` só são lidos hoje em [request-context.middleware.ts:78-79](../../apps/api/src/shared/logging/request-context.middleware.ts#L78-L79); `trust proxy` já está configurado em [main.ts:51-59](../../apps/api/src/main.ts#L51-L59).
- `PerfilDialog` ([PerfilDialog.tsx](../../apps/web/src/features/perfil/PerfilDialog.tsx)) é um único `<form>` de nome/e-mail; `perfilApi` só tem `me` e `update`.

## Desired End State

- `User.refreshTokenHash` **não existe mais**. Existe `model Session` (sem RLS), uma linha por dispositivo logado, com `tokenHash`, `userAgent`, `ip`, `createdAt`, `lastUsedAt`, `expiresAt`, `revokedAt`.
- Access token e refresh token carregam `{ sub, sid }`. O refresh valida em O(1): `findUnique(sid)` + 1 `argon2.verify`, e **rotaciona na mesma sessão** (o `sid` é estável por dispositivo).
- `POST /auth/login`, `/auth/register`, `/auth/refresh`, o callback OAuth e o aceite de convite criam/atualizam uma sessão registrando IP e User-Agent.
- `POST /auth/logout` revoga **só a sessão corrente**; redefinição de senha e desativação de colaborador revogam **todas** as do usuário.
- `GET /auth/sessions` lista as sessões ativas do próprio usuário com um rótulo legível de dispositivo ("Chrome no Windows"), IP, último uso e a marcação de qual é a atual. `DELETE /auth/sessions/:id` revoga uma; `DELETE /auth/sessions` revoga todas menos a atual.
- O `PerfilDialog` mostra a seção "Sessões ativas", com revogação individual e "Encerrar as outras sessões", via `ConfirmDialog`.
- Zero dependência nova em `apps/api` e em `apps/web`.

## What We're NOT Doing

- **Detecção de reuso de refresh token** — o modelo de dados nasce compatível (a sessão guarda o hash do token **vigente**; um token já rotacionado falha o `verify`), mas apresentar um token antigo continua sendo apenas `401`, sem revogar a família. O ROADMAP pede sessões múltiplas, não hardening.
- **Revogação instantânea do access token** — revogar uma sessão mata o refresh; o access token daquele dispositivo continua valendo até expirar (`JWT_ACCESS_TTL`). É o mesmo comportamento do logout de hoje. Tornar imediato exigiria o `AccessGuard` consultar `Session` a cada requisição — decisão separada.
- **`ownerId` na linha de `Session`** — a sessão é estritamente pessoal nesta fase. O owner **não** vê nem revoga sessões de colaboradores pela tela de colaboradores (a desativação já revoga todas). Sem `ownerId`, sem policy, sem coluna especulativa.
- **Dependência de parsing de User-Agent** — `ua-parser-js` v2 é AGPLv3 e é incompatível com a Apache-2.0 do projeto; alternativas MIT quebrariam o padrão "nenhuma dependência nova". O rótulo sai de uma heurística curta no próprio repositório, com a string crua como reserva.
- **Limite de sessões simultâneas por usuário** e **expurgo automático de sessões expiradas** — sem cron nesta fase. A listagem filtra por `revokedAt: null` e `expiresAt > agora`; linhas mortas ficam na tabela.
- **Nomear a sessão** ("MacBook do escritório") — só o rótulo derivado.

---

## Phase 1: Tabela `Session` e emissão com `sid`

### Goal

Trocar o hash único por uma tabela de sessões e fazer login/refresh/logout operarem sobre ela, sem nenhuma mudança visível na interface.

### Changes

#### Banco

**Modify**: `apps/api/prisma/schema.prisma`

Em `model User` (linhas 13-47): remover `refreshTokenHash` e declarar a back-relation.

```prisma
model User {
  id               String         @id @default(uuid())
  name             String
  email            String         @unique
  passwordHash     String? // opcional: conta criada via OAuth ou convite de colaborador ainda não aceito
  stripeCustomerId String?        @unique // billing (SaaS hospedado) — ausente na autohospedagem
  // ... (restante inalterado)
  oauthAccounts    OAuthAccount[]
  passwordResetTokens PasswordResetToken[]
  sessions         Session[]
  // ...
}
```

Novo modelo, logo após `PasswordResetToken` (linha 119):

```prisma
// Sessão de refresh: uma linha por dispositivo logado. Substitui o antigo
// `User.refreshTokenHash` (valor único), que permitia uma sessão por usuário.
//
// Fica FORA do RLS, no mesmo grupo de User/OAuthAccount/PasswordResetToken: a
// linha nasce no login, que é rota @Public() e roda sem `app.owner_id` — uma
// policy `owner_isolation` aqui fecharia a escrita (fail-closed = zero linhas).
// O isolamento é por filtro explícito de `userId` no SessionsService.
//
// `tokenHash` é o argon2 do refresh token VIGENTE: cada refresh rotaciona o
// token e reescreve o hash na MESMA sessão (o `sid` do payload é estável).
// argon2 (e não sha256, como o token de reset) porque o `sid` vem no payload —
// a busca é por chave primária, e o hash não precisa ser indexável.
model Session {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String
  /// User-Agent cru da requisição que criou/renovou a sessão (truncado em 255).
  userAgent  String?
  /// IP do cliente (req.ip, já resolvido por trust proxy — ver main.ts).
  ip         String?
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime  @default(now())
  /// Janela deslizante: cada refresh empurra a expiração, igual ao maxAge do cookie.
  expiresAt  DateTime
  revokedAt  DateTime?

  @@index([userId, revokedAt])
  @@index([expiresAt])
}
```

**Create**: `apps/api/prisma/migrations/20260728100000_sessions/migration.sql`

```sql
-- Sessões múltiplas: uma linha por dispositivo logado, substituindo o
-- `User.refreshTokenHash` (valor único, uma sessão por usuário).
--
-- Notas de projeto:
--  * Session fica FORA do RLS, como User/OAuthAccount/PasswordResetToken: a
--    linha é criada no login (@Public), onde não existe `app.owner_id`. Uma
--    policy aqui casaria zero linhas (fail-closed) e fecharia o login.
--  * Sem GRANT explícito: o `ALTER DEFAULT PRIVILEGES` de
--    20260724040000_create_app_role já concede os quatro verbos a crm_app em
--    toda tabela criada depois por crm_user (que é quem roda as migrations).
--  * ON DELETE CASCADE: apagar o usuário apaga as sessões dele (o inverso de
--    `assigneeId`, que é dado de negócio do owner e usa SET NULL).
--  * DROP COLUMN "refreshTokenHash" DERRUBA TODAS AS SESSÕES ATIVAS em produção
--    — todo mundo precisa entrar de novo. É esperado e não há backfill possível
--    (o hash antigo não tem `sid` correspondente).
--  * Roda como crm_user (superuser), que bypassa RLS.

CREATE TABLE "Session" (
  "id"         TEXT         NOT NULL,
  "userId"     TEXT         NOT NULL,
  "tokenHash"  TEXT         NOT NULL,
  "userAgent"  TEXT,
  "ip"         TEXT,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"  TIMESTAMP(3) NOT NULL,
  "revokedAt"  TIMESTAMP(3),

  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");
CREATE INDEX "Session_expiresAt_idx"        ON "Session"("expiresAt");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" DROP COLUMN "refreshTokenHash";
```

#### Serviço de sessões

**Modify**: `apps/api/src/modules/auth/refresh-cookie.ts`

O TTL da sessão e o `maxAge` do cookie têm de ser o mesmo número — hoje o `7 * 24 * 60 * 60 * 1000` está inline. Extrair e exportar.

```ts
/** Nome e caminho do cookie de refresh — o path restringe o envio às rotas de auth. */
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Vida da sessão de refresh. É o `maxAge` do cookie **e** o `expiresAt` da linha
 * em `Session` — os dois precisam ser o mesmo número, senão a sessão morre no
 * banco enquanto o navegador ainda manda o cookie (ou o contrário).
 */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

export function setRefreshCookie(
  res: Response,
  token: string,
  config: ConfigService,
) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.get('NODE_ENV') === 'production',
    domain: config.get('COOKIE_DOMAIN'),
    path: REFRESH_COOKIE_PATH,
    maxAge: SESSION_TTL_MS,
  });
}
```

**Create**: `apps/api/src/modules/auth/sessions.service.ts`

Porta única de escrita e leitura de `Session`. Segue o estilo de `UsersService` (módulo transversal simples, sem a subdivisão `domain/application/infra` — permitido pelo `apps/api/CLAUDE.md`).

```ts
import { Injectable, Logger } from '@nestjs/common';
import type { Session } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_TTL_MS } from './refresh-cookie';

/** Contexto do dispositivo, colhido na fronteira HTTP (controller). */
export interface DeviceInfo {
  ip?: string | null;
  userAgent?: string | null;
}

/** User-Agent cabe em 255 — string maior que isso é ruído (ou ataque). */
const UA_MAX = 255;

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * `prisma.db` de propósito: em rota pública (login/refresh) devolve o client
   * base, e em rota autenticada (logout/revogar) entra na transação do request.
   * `Session` não tem policy, então `app.owner_id` é irrelevante nos dois casos.
   */
  private get db() {
    return this.prisma.db;
  }

  private trim(ua?: string | null): string | null {
    return ua ? ua.slice(0, UA_MAX) : null;
  }

  /** Cria a sessão do dispositivo. O `id` é o `sid` que vai no payload dos JWTs. */
  create(data: {
    id: string;
    userId: string;
    tokenHash: string;
    device: DeviceInfo;
  }): Promise<Session> {
    return this.db.session.create({
      data: {
        id: data.id,
        userId: data.userId,
        tokenHash: data.tokenHash,
        ip: data.device.ip ?? null,
        userAgent: this.trim(data.device.userAgent),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  findById(id: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { id } });
  }

  /**
   * Rotação: mesmo `sid`, token novo. Empurra `expiresAt` junto com o cookie
   * (janela deslizante) e reescreve IP/UA — a sessão passa a refletir onde ela
   * está sendo usada agora, não onde nasceu.
   */
  rotate(id: string, tokenHash: string, device: DeviceInfo): Promise<Session> {
    return this.db.session.update({
      where: { id },
      data: {
        tokenHash,
        lastUsedAt: new Date(),
        ip: device.ip ?? null,
        userAgent: this.trim(device.userAgent),
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    });
  }

  /** Sessões que ainda valem, da mais usada recentemente para a mais antiga. */
  findActiveByUser(userId: string): Promise<Session[]> {
    return this.db.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * Revoga uma sessão do próprio usuário. `updateMany` com os dois filtros:
   * `Session` não tem RLS, então o `userId` é o que impede revogar a sessão de
   * outra pessoa. Devolve `false` quando nada foi afetado (id alheio/inexistente).
   */
  async revoke(id: string, userId: string): Promise<boolean> {
    const { count } = await this.db.session.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count > 0;
  }

  /** Revoga todas as sessões do usuário, com a opção de preservar a corrente. */
  async revokeAll(userId: string, exceptId?: string): Promise<number> {
    const { count } = await this.db.session.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
    return count;
  }
}
```

#### AuthService

**Modify**: `apps/api/src/modules/auth/auth.service.ts`

Imports e construtor:

```ts
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SessionsService, type DeviceInfo } from './sessions.service';

// ...
  constructor(
    private users: UsersService,
    private sessions: SessionsService,
    private jwt: JwtService,
    private config: ConfigService,
    private mail: MailService,
  ) {}
```

`issueTokens` (substitui as linhas 264-284) — agora recebe o dispositivo e cria a sessão:

```ts
  /**
   * Emite o par de tokens e abre uma sessão nova. O `sid` (id da sessão) vai no
   * payload dos DOIS tokens: no refresh porque é ele que torna a validação uma
   * busca por chave primária (sem `sid`, validar N sessões custaria N
   * `argon2.verify`); no access porque logout e "revogar esta sessão" precisam
   * saber qual é a sessão corrente numa rota autenticada.
   */
  private async issueTokens(sub: string, device: DeviceInfo = {}) {
    const sid = randomUUID();
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub, sid },
        {
          secret: this.config.get('JWT_ACCESS_SECRET'),
          expiresIn: this.config.get('JWT_ACCESS_TTL'),
        },
      ),
      this.jwt.signAsync(
        { sub, sid },
        {
          secret: this.config.get('JWT_REFRESH_SECRET'),
          expiresIn: this.config.get('JWT_REFRESH_TTL'),
        },
      ),
    ]);
    await this.sessions.create({
      id: sid,
      userId: sub,
      tokenHash: await this.hashSecret(refreshToken),
      device,
    });
    return { accessToken, refreshToken };
  }
```

`refresh` (substitui as linhas 207-225) — valida a sessão e rotaciona sem trocar o `sid`:

```ts
  /**
   * Renova o par de tokens **na mesma sessão**: o `sid` é estável por
   * dispositivo, então a linha de `Session` acompanha o aparelho ao longo do
   * tempo (é o que dá sentido a "último uso" na lista do perfil).
   */
  async refresh(sid: string, userId: string, refreshToken: string, device: DeviceInfo = {}) {
    const session = await this.sessions.findById(sid);
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt.getTime() <= Date.now() ||
      !(await argon2.verify(session.tokenHash, refreshToken))
    ) {
      throw new UnauthorizedException();
    }
    const user = await this.users.findById(userId);
    if (!user) throw new UnauthorizedException();
    // Desativar o colaborador derruba a sessão dele no próximo refresh, mesmo
    // que o cookie ainda esteja no navegador.
    this.assertActive(user.active);

    const accessToken = await this.jwt.signAsync(
      { sub: userId, sid },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL'),
      },
    );
    const nextRefresh = await this.jwt.signAsync(
      { sub: userId, sid },
      {
        secret: this.config.get('JWT_REFRESH_SECRET'),
        expiresIn: this.config.get('JWT_REFRESH_TTL'),
      },
    );
    await this.sessions.rotate(sid, await this.hashSecret(nextRefresh), device);
    return { accessToken, refreshToken: nextRefresh };
  }
```

`logout` (substitui as linhas 260-262) e `resetPassword` (linha 190):

```ts
  /** Encerra apenas a sessão corrente — os outros dispositivos seguem logados. */
  async logout(userId: string, sid?: string) {
    if (sid) await this.sessions.revoke(sid, userId);
    // Access token emitido antes do `sid` (deploy da Fase 8A) não traz sessão:
    // nesse caso o logout derruba tudo, que é o comportamento antigo.
    else await this.sessions.revokeAll(userId);
  }
```

```ts
    await this.users.markResetTokenUsed(record.id, new Date());
    await this.users.deletePendingResetTokens(record.userId);
    // Trocar a senha derruba TODOS os dispositivos: é o caminho de quem suspeita
    // que a conta foi acessada por outra pessoa.
    await this.sessions.revokeAll(record.userId);
```

`issueSession` e os callers de `issueTokens` (`register`, `login`, `oauthLogin` nos três ramos) passam a repassar o `device`:

```ts
  async register(name: string, email: string, password: string, device: DeviceInfo = {}) { /* … */ return this.issueTokens(user.id, device); }
  async login(email: string, password: string, device: DeviceInfo = {}) { /* … */ return this.issueTokens(user.id, device); }
  async oauthLogin(provider: OAuthProvider, profile: OAuthProfile, device: DeviceInfo = {}) { /* … */ }
  /** Emite sessão para um usuário já validado (usado no aceite do convite). */
  issueSession(userId: string, device: DeviceInfo = {}) { return this.issueTokens(userId, device); }
```

`me` e `updateProfile` desestruturam `refreshTokenHash` (linhas 232 e 256) — o campo deixa de existir; remover das duas desestruturações:

```ts
    const { passwordHash, ownerId, roleId, ...safe } = user;   // me
    const { passwordHash, ...safe } = user;                    // updateProfile
```

**Modify**: `apps/api/src/modules/users/users.service.ts`

Remover `setRefreshTokenHash` (linhas 143-148) inteiro — não há mais campo.

**Modify**: `apps/api/src/modules/auth/jwt-auth.guard.ts`

O payload verificado passa a ter `sid`:

```ts
type AuthedRequest = Request & { user: { sub: string; sid?: string } };
// …
      req.user = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
```

**Modify**: `apps/api/src/modules/access/domain/access-context.ts`

```ts
/** Requisição autenticada: `user` vem do `JwtAuthGuard`, `access` do `AccessGuard`. */
export type AuthenticatedRequest = Request & {
  /** `sid` é o id da sessão (ver modelo `Session`); ausente em token emitido antes da Fase 8A. */
  user?: { sub?: string; sid?: string };
  access?: AccessContext;
};
```

**Modify**: `apps/api/src/shared/current-user.decorator.ts`

Novo decorator, ao lado de `CurrentUserId`:

```ts
/**
 * Id da **sessão corrente** (`req.user.sid`), o mesmo `sid` do payload dos JWTs.
 * Use no logout e na lista de sessões do perfil. `undefined` num access token
 * emitido antes da Fase 8A — trate como "não sei qual é a sessão atual".
 */
export const CurrentSessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user?.sid;
  },
);
```

#### Controllers e módulo

**Modify**: `apps/api/src/modules/auth/auth.controller.ts`

Helper de dispositivo e repasse em `register`, `login`, `refresh` e `oauthCallback`:

```ts
import { SessionsService, type DeviceInfo } from './sessions.service';
import { CurrentSessionId } from '../../shared/current-user.decorator';

  /** Dispositivo da requisição — `req.ip` já é o IP real (trust proxy, ver main.ts). */
  private device(req: Request): DeviceInfo {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }
```

`refresh` (substitui as linhas 105-126) passa a ler o `sid` do payload:

```ts
  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token = (req.cookies as Record<string, string | undefined>)?.[
      REFRESH_COOKIE
    ];
    if (!token) throw new UnauthorizedException();
    let sub: string;
    let sid: string | undefined;
    try {
      ({ sub, sid } = await this.jwt.verifyAsync<{ sub: string; sid?: string }>(
        token,
        { secret: this.config.get<string>('JWT_REFRESH_SECRET') },
      ));
    } catch {
      throw new UnauthorizedException();
    }
    // Refresh emitido antes da Fase 8A não tem `sid`: não há sessão a validar,
    // e o usuário entra de novo. Some sozinho em 7 dias.
    if (!sid) throw new UnauthorizedException();
    const { accessToken, refreshToken } = await this.auth.refresh(
      sid,
      sub,
      token,
      this.device(req),
    );
    this.setRefreshCookie(res, refreshToken);
    return { accessToken };
  }
```

`logout` (linhas 138-146):

```ts
  @Post('logout')
  async logout(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.logout(userId, sid);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
    return { ok: true };
  }
```

**Modify**: `apps/api/src/modules/collaborators/domain/collaborator.repository.ts` e `apps/api/src/modules/collaborators/infra/prisma-collaborator.repository.ts`

`revokeSession` vira `revokeSessions` (plural) e passa a apagar todas as sessões do colaborador. A posse já foi verificada por `findOrFail` no service, mas o filtro por `ownerId` continua explícito:

```ts
  /**
   * Desativar sem revogar deixaria vivos os refresh tokens dos navegadores dele.
   * O filtro por `ownerId` é redundante com o `findOrFail` do service, mas
   * `Session`/`User` não têm RLS — a defesa é explícita por princípio.
   */
  async revokeSessions(id: string, ownerId: string): Promise<number> {
    const target = await this.prisma.db.user.findFirst({
      where: { id, ownerId },
      select: { id: true },
    });
    if (!target) return 0;
    const { count } = await this.prisma.db.session.updateMany({
      where: { userId: id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }
```

**Modify**: `apps/api/src/modules/collaborators/application/collaborators.service.ts:141-143`

```ts
    // Desativar sem revogar deixaria vivos os refresh tokens dos navegadores dele.
    if (data.active === false) {
      const revogadas = await this.collaborators.revokeSessions(id, ownerId);
      this.logger.log({
        evento: 'sessoes.revogadas',
        msg: 'Sessões do colaborador revogadas na desativação.',
        colaboradorId: id,
        quantidade: revogadas,
      });
    }
```

**Modify**: `apps/api/src/modules/collaborators/api/invites.controller.ts:51-60`

```ts
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = await this.invites.accept(token, dto.password);
    const { accessToken, refreshToken } = await this.auth.issueSession(userId, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    setRefreshCookie(res, refreshToken, this.config);
    return { accessToken };
  }
```

**Modify**: `apps/api/src/modules/auth/auth.module.ts`

Registrar `SessionsService` em `providers` e em `exports` (o `CollaboratorsModule` não precisa dele — usa o repositório próprio —, mas o export mantém a fronteira explícita para o futuro).

#### Testes

**Modify**: `apps/api/src/modules/auth/auth.service.spec.ts`

- Remover `setRefreshTokenHash` do mock de `UsersService` (linhas 26 e 47).
- Adicionar o mock de `SessionsService` e passá-lo no `new AuthService(...)`:

```ts
  let sessions: jest.Mocked<
    Pick<SessionsService, 'create' | 'findById' | 'rotate' | 'revoke' | 'revokeAll'>
  >;
  // …
    sessions = {
      create: jest.fn().mockResolvedValue(undefined),
      findById: jest.fn(),
      rotate: jest.fn().mockResolvedValue(undefined),
      revoke: jest.fn().mockResolvedValue(true),
      revokeAll: jest.fn().mockResolvedValue(1),
    };
    service = new AuthService(
      users as unknown as UsersService,
      sessions as unknown as SessionsService,
      jwt as unknown as JwtService,
      config,
      mail as unknown as MailService,
    );
```

- No teste "emite tokens e persiste o hash do refresh quando a senha confere" (linhas 85-98), trocar a asserção por:

```ts
      expect(sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u1', tokenHash: expect.any(String) }),
      );
```

- Reescrever o `describe('refresh')` (linhas 174-217) sobre a sessão:

```ts
  describe('refresh', () => {
    const sessaoValida = async (over: Partial<Session> = {}) => ({
      id: 's1',
      userId: 'u1',
      tokenHash: await argon2.hash('refresh-valido'),
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      ...over,
    });

    it('rejeita quando a sessão não existe', async () => {
      sessions.findById.mockResolvedValue(null);
      await expect(service.refresh('s1', 'u1', 't')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita sessão de outro usuário (sid roubado)', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida({ userId: 'u2' }) as any);
      await expect(service.refresh('s1', 'u1', 'refresh-valido')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita sessão revogada', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida({ revokedAt: new Date() }) as any);
      await expect(service.refresh('s1', 'u1', 'refresh-valido')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita sessão expirada', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida({ expiresAt: new Date(Date.now() - 1) }) as any);
      await expect(service.refresh('s1', 'u1', 'refresh-valido')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejeita token que não confere com o hash vigente (já rotacionado)', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida() as any);
      await expect(service.refresh('s1', 'u1', 'token-antigo')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rotaciona na MESMA sessão quando o refresh confere', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida() as any);
      users.findById.mockResolvedValue({ id: 'u1', active: true } as any);
      const r = await service.refresh('s1', 'u1', 'refresh-valido');
      expect(r).toEqual({ accessToken: 'token', refreshToken: 'token' });
      expect(sessions.rotate).toHaveBeenCalledWith('s1', expect.any(String), expect.anything());
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejeita o refresh de colaborador desativado', async () => {
      sessions.findById.mockResolvedValue(await sessaoValida() as any);
      users.findById.mockResolvedValue({ id: 'u1', active: false } as any);
      await expect(service.refresh('s1', 'u1', 'refresh-valido')).rejects.toThrow(
        'Seu acesso ao CRM foi desativado',
      );
    });
  });
```

- No teste de `resetPassword` (linha 311), trocar a asserção por `expect(sessions.revokeAll).toHaveBeenCalledWith('u1')`.
- Novo `describe('logout')`: com `sid` revoga só aquela sessão; sem `sid` revoga todas.

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api exec prisma migrate dev` — a migration aplica sem erro no banco local
- [x] `pnpm --filter api exec prisma generate` — o client reflete `Session` e `User` sem `refreshTokenHash`
- [x] `pnpm --filter api build` — nenhuma referência remanescente a `refreshTokenHash` ou `setRefreshTokenHash`
- [x] `pnpm --filter api test` — a suíte de `auth.service.spec.ts` passa com os casos novos de sessão
- [x] `pnpm --filter api lint` — sem erros (os 2 erros em `main.ts` são pré-existentes, não relacionados a esta fase)
- [x] `grep -rn "refreshTokenHash" apps/api/src apps/api/prisma/schema.prisma` — zero ocorrências

#### Manual Verification
- [ ] Entrar em dois navegadores diferentes com a mesma conta: **os dois continuam logados** (hoje o segundo derruba o primeiro)
- [ ] Em cada navegador, esperar o access token expirar (ou apagá-lo do `sessionStorage`) e navegar: o refresh renova a sessão sem deslogar o outro
- [ ] `select id, "userId", ip, "userAgent", "lastUsedAt" from "Session"` — duas linhas, com IP e User-Agent preenchidos e `lastUsedAt` avançando a cada refresh
- [ ] Fazer logout em um dos navegadores: **só ele** cai; o outro segue funcionando; a linha dele fica com `revokedAt` preenchido
- [ ] Redefinir a senha pelo fluxo de "Esqueci minha senha": **os dois** caem no próximo refresh
- [ ] Desativar um colaborador pela tela de colaboradores: as sessões dele ficam com `revokedAt` e ele cai na requisição seguinte
- [ ] Aceitar um convite novo: a sessão nasce com IP/UA preenchidos

**⏸ PAUSE**: Após a verificação automatizada passar, parar para confirmação humana dos testes manuais antes de seguir para a Fase 2.

---

## Phase 2: Endpoints de sessão e rótulo de dispositivo

### Goal

Expor a lista de sessões ativas do próprio usuário e as duas formas de revogação, com um rótulo de dispositivo legível derivado do User-Agent.

### Changes

#### Rótulo de dispositivo

**Create**: `apps/api/src/shared/user-agent.ts`

```ts
/**
 * Rótulo legível de dispositivo a partir do User-Agent — "Chrome no Windows".
 *
 * Heurística curta e deliberadamente burra, sem dependência: `ua-parser-js` v2
 * é AGPLv3 (incompatível com a Apache-2.0 deste repositório) e trazer uma lib
 * MIT quebraria o padrão "nenhuma dependência nova" dos planos anteriores.
 * O custo aceito é errar em User-Agent exótico — nesses casos devolvemos a
 * string crua truncada, que ainda diz alguma coisa a quem olha.
 *
 * A ORDEM DOS TESTES IMPORTA: Edge e Opera se declaram Chrome, e Chrome se
 * declara Safari. Do mais específico para o mais genérico.
 */

const NAVEGADORES: ReadonlyArray<[RegExp, string]> = [
  [/edg[ea]?\//i, 'Edge'],
  [/opr\/|opera/i, 'Opera'],
  [/samsungbrowser/i, 'Samsung Internet'],
  [/firefox\/|fxios/i, 'Firefox'],
  [/chrome\/|crios/i, 'Chrome'],
  [/safari\//i, 'Safari'],
];

const SISTEMAS: ReadonlyArray<[RegExp, string]> = [
  [/windows nt/i, 'Windows'],
  [/iphone|ipad|ipod/i, 'iOS'],
  [/android/i, 'Android'],
  [/mac os x|macintosh/i, 'macOS'],
  [/linux/i, 'Linux'],
];

const RESERVA_MAX = 60;

function primeiro(
  tabela: ReadonlyArray<[RegExp, string]>,
  ua: string,
): string | null {
  return tabela.find(([re]) => re.test(ua))?.[1] ?? null;
}

/** `null`/vazio → "Dispositivo desconhecido". Nunca lança. */
export function describeUserAgent(ua?: string | null): string {
  if (!ua) return 'Dispositivo desconhecido';
  const navegador = primeiro(NAVEGADORES, ua);
  const sistema = primeiro(SISTEMAS, ua);
  if (navegador && sistema) return `${navegador} no ${sistema}`;
  if (navegador) return navegador;
  if (sistema) return sistema;
  return ua.length > RESERVA_MAX ? `${ua.slice(0, RESERVA_MAX)}…` : ua;
}
```

**Create**: `apps/api/src/shared/user-agent.spec.ts`

Teste unitário puro (sem DI), cobrindo a ordem dos testes — é onde a heurística erra:

```ts
import { describeUserAgent } from './user-agent';

describe('describeUserAgent', () => {
  it.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36', 'Chrome no Windows'],
    ['Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0', 'Edge no Windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 'Safari no macOS'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 CriOS/120.0 Mobile/15E148 Safari/604.1', 'Chrome no iOS'],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0', 'Firefox no Linux'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36', 'Chrome no Android'],
  ])('%s → %s', (ua, esperado) => {
    expect(describeUserAgent(ua)).toBe(esperado);
  });

  it('devolve texto de reserva quando não há User-Agent', () => {
    expect(describeUserAgent(null)).toBe('Dispositivo desconhecido');
    expect(describeUserAgent('')).toBe('Dispositivo desconhecido');
  });

  it('devolve a string crua truncada para User-Agent irreconhecível', () => {
    expect(describeUserAgent('curl/8.4.0')).toBe('curl/8.4.0');
  });
});
```

#### Serviço e rotas

**Modify**: `apps/api/src/modules/auth/sessions.service.ts`

Projeção para a interface, com o rótulo já resolvido:

```ts
import { describeUserAgent } from '../../shared/user-agent';

/** Sessão como o perfil consome — sem `tokenHash`, com rótulo pronto. */
export interface SessionView {
  id: string;
  device: string;
  ip: string | null;
  createdAt: Date;
  lastUsedAt: Date;
  /** `true` na sessão que fez esta requisição. */
  current: boolean;
}

  /** Lista as sessões ativas do usuário, marcando qual é a corrente. */
  async listForUser(userId: string, currentSid?: string): Promise<SessionView[]> {
    const rows = await this.findActiveByUser(userId);
    return rows.map((s) => ({
      id: s.id,
      device: describeUserAgent(s.userAgent),
      ip: s.ip,
      createdAt: s.createdAt,
      lastUsedAt: s.lastUsedAt,
      current: s.id === currentSid,
    }));
  }
```

**Modify**: `apps/api/src/modules/auth/auth.service.ts`

Fachada — o controller fala com o `AuthService`, não com o `SessionsService` (mesma fronteira que `users`):

```ts
  /** Sessões ativas do próprio usuário, para a tela de perfil. */
  listSessions(userId: string, currentSid?: string) {
    return this.sessions.listForUser(userId, currentSid);
  }

  /** Revoga uma sessão do próprio usuário. 404 para id alheio ou já revogado. */
  async revokeSession(userId: string, id: string) {
    const revogada = await this.sessions.revoke(id, userId);
    if (!revogada) throw new NotFoundException('Sessão não encontrada.');
    this.logger.log({
      evento: 'sessao.revogada',
      msg: 'Sessão revogada pelo próprio usuário.',
      sessaoId: id,
    });
    return { ok: true };
  }

  /** Encerra os demais dispositivos, preservando o que fez a requisição. */
  async revokeOtherSessions(userId: string, currentSid?: string) {
    const quantidade = await this.sessions.revokeAll(userId, currentSid);
    this.logger.log({
      evento: 'sessoes.revogadas',
      msg: 'Demais sessões encerradas pelo próprio usuário.',
      quantidade,
    });
    return { revoked: quantidade };
  }
```

**Modify**: `apps/api/src/modules/auth/auth.controller.ts`

Três rotas novas, autenticadas e **sem** `@RequirePermission` — são de identidade, como `PATCH /auth/me`. Declaradas **antes** de nenhuma rota com `:param` conflitante (`/auth/sessions` não colide com nada existente).

```ts
  /** Sessões ativas do próprio usuário (perfil → "Sessões ativas"). */
  @Get('sessions')
  sessions(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
  ) {
    return this.auth.listSessions(userId, sid);
  }

  /** Encerra as demais sessões, preservando a atual. */
  @Delete('sessions')
  revokeOtherSessions(
    @CurrentUserId() userId: string,
    @CurrentSessionId() sid: string | undefined,
  ) {
    return this.auth.revokeOtherSessions(userId, sid);
  }

  /** Encerra uma sessão específica do próprio usuário. */
  @Delete('sessions/:id')
  revokeSession(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.auth.revokeSession(userId, id);
  }
```

Importar `Delete` de `@nestjs/common` e `NotFoundException` no service.

#### Documentação

**Modify**: `apps/api/ENDPOINTS.md`

Na seção `## Auth`, após `PATCH /auth/me`, três entradas no formato fixo:

```markdown
### GET /auth/sessions
- **Propósito:** Listar as sessões ativas (dispositivos logados) do próprio usuário, da mais usada recentemente para a mais antiga.
- **Auth:** Bearer (access token). Sem permissão — é dado de identidade do próprio usuário.
- **Body:** —
- **Resposta:** `200 Array<{ id, device, ip, createdAt, lastUsedAt, current }>`. `device` é um rótulo derivado do User-Agent ("Chrome no Windows"); `current: true` marca a sessão que fez esta requisição (ausente em access token emitido antes da Fase 8A).
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.sessions`

### DELETE /auth/sessions
- **Propósito:** Encerrar todas as sessões do próprio usuário **exceto a atual** ("Encerrar as outras sessões").
- **Auth:** Bearer (access token). Sem permissão.
- **Body:** —
- **Resposta:** `200 { revoked: number }`.
- **Erros:** `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.revokeOtherSessions`

### DELETE /auth/sessions/:id
- **Propósito:** Encerrar uma sessão específica do próprio usuário. O dispositivo revogado cai no próximo refresh; o access token dele vale até expirar.
- **Auth:** Bearer (access token). Sem permissão — só alcança sessões do próprio `userId`.
- **Body:** —
- **Resposta:** `200 { ok: true }`.
- **Erros:** `404 Sessão não encontrada.` (id inexistente, de outro usuário ou já revogado), `401`.
- **Handler:** `modules/auth/auth.controller.ts` → `AuthController.revokeSession`
```

Ainda em `ENDPOINTS.md`, atualizar `POST /auth/logout`: o propósito passa a ser "Encerrar **a sessão corrente**".

**Modify**: `docs/observabilidade.md`

Na tabela "Eventos que a API emite" (linhas 57-68), duas linhas novas:

```markdown
| `sessao.revogada` | uma sessão encerrada pelo próprio usuário | `info` |
| `sessoes.revogadas` | encerramento em massa (outras sessões, desativação de colaborador) | `info` |
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter api test` — `user-agent.spec.ts` passa, incluindo os casos de ordem (Edge antes de Chrome, Chrome antes de Safari)
- [x] `pnpm --filter api build` e `pnpm --filter api lint` — sem erros
- [ ] `curl -H "Authorization: Bearer $TOKEN" localhost:3000/api/v1/auth/sessions` devolve a lista com `device` legível e exatamente um `current: true` (requer servidor no ar e token real — verificação manual)

#### Manual Verification
- [ ] Com dois navegadores logados, `GET /auth/sessions` em cada um retorna **duas** sessões, e `current: true` é a de quem chamou
- [ ] `DELETE /auth/sessions/:id` da outra sessão: ela some da lista; o outro navegador cai no próximo refresh
- [ ] `DELETE /auth/sessions/:id` com um id de sessão de **outra conta** responde `404` (e não revoga nada)
- [ ] `DELETE /auth/sessions` com três navegadores logados: sobra só o atual, e a resposta traz `revoked: 2`
- [ ] O Grafana recebe `sessao.revogada` / `sessoes.revogadas` sem nenhum campo com token ou hash

**⏸ PAUSE**: Parar para confirmação humana antes de seguir para a Fase 3.

---

## Phase 3: Sessões ativas no perfil

### Goal

Mostrar as sessões ativas dentro do `PerfilDialog`, com revogação individual e em massa, confirmadas por `ConfirmDialog`.

### Changes

#### Helper de tempo relativo

**Modify**: `apps/web/src/lib/format.ts`

O projeto não tem lib de data e não tem helper de tempo relativo — "há 5 minutos" é a informação útil numa lista de sessões. Acrescentar ao final do arquivo:

```ts
const relativeFmt = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });

/** Escalas em segundos, da maior para a menor — a primeira que couber vence. */
const RELATIVE_UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
];

/**
 * Tempo relativo em pt-BR ("agora mesmo", "há 5 minutos", "há 2 dias").
 * Usa `Intl.RelativeTimeFormat` — sem dependência de data no projeto.
 */
export function formatRelativeTime(value?: string | Date | null): string {
  if (!value) return '';
  const diff = (new Date(value).getTime() - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return 'agora mesmo';
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (abs >= seconds) {
      return relativeFmt.format(Math.round(diff / seconds), unit);
    }
  }
  return 'agora mesmo';
}
```

#### Camada de dados

**Modify**: `apps/web/src/lib/query-keys.ts`

```ts
  auth: {
    oauthProviders: ['auth', 'oauth-providers'] as const,
    registration: ['auth', 'registration'] as const,
    me: ['auth', 'me'] as const,
    sessions: ['auth', 'sessions'] as const,
  },
```

**Modify**: `apps/web/src/features/perfil/api/perfil.api.ts`

```ts
/** Sessão ativa do usuário (um dispositivo logado). */
export type Session = {
  id: string;
  /** Rótulo derivado do User-Agent pela API ("Chrome no Windows"). */
  device: string;
  ip: string | null;
  createdAt: string;
  lastUsedAt: string;
  /** `true` na sessão deste navegador — não pode ser revogada pela lista. */
  current: boolean;
};

export const perfilApi = {
  me: () => api.get<Me>('/auth/me').then((r) => r.data),
  update: (body: UpdateProfileBody) =>
    api.patch<Me>('/auth/me', body).then((r) => r.data),
  sessions: () => api.get<Session[]>('/auth/sessions').then((r) => r.data),
  revokeSession: (id: string) =>
    api.delete<{ ok: true }>(`/auth/sessions/${id}`).then((r) => r.data),
  revokeOtherSessions: () =>
    api.delete<{ revoked: number }>('/auth/sessions').then((r) => r.data),
};
```

**Modify**: `apps/web/src/features/perfil/api/hooks.ts`

```ts
export function useSessions(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.auth.sessions,
    queryFn: () => perfilApi.sessions(),
    enabled: options?.enabled ?? true,
  });
}

function invalidateSessions(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.auth.sessions });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => perfilApi.revokeSession(id),
    onSuccess: () => invalidateSessions(qc),
  });
}

export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => perfilApi.revokeOtherSessions(),
    onSuccess: () => invalidateSessions(qc),
  });
}
```

#### Interface

**Create**: `apps/web/src/features/perfil/SessoesAtivas.tsx`

Seção isolada — mantém o `PerfilDialog` legível e permite reaproveitar depois.

```tsx
import { useState } from 'react';
import { toast } from 'sonner';
import { Laptop, LogOut } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { extractApiMessage } from '@/lib/api-error';
import { formatRelativeTime } from '@/lib/format';
import { useRevokeOtherSessions, useRevokeSession, useSessions } from './api/hooks';
import type { Session } from './api/perfil.api';

interface SessoesAtivasProps {
  /** Só busca quando o diálogo está aberto — evita requisição em tela fechada. */
  enabled: boolean;
}

export function SessoesAtivas({ enabled }: SessoesAtivasProps) {
  const { data: sessions, isLoading, isError } = useSessions({ enabled });
  const revoke = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();

  const [revoking, setRevoking] = useState<Session | null>(null);
  const [othersOpen, setOthersOpen] = useState(false);

  const outras = (sessions ?? []).filter((s) => !s.current).length;

  const confirmRevoke = async () => {
    if (!revoking) return;
    try {
      await revoke.mutateAsync(revoking.id);
      toast.success('Sessão encerrada.');
      setRevoking(null);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao encerrar a sessão.'));
    }
  };

  const confirmRevokeOthers = async () => {
    try {
      const { revoked } = await revokeOthers.mutateAsync();
      toast.success(
        revoked === 1 ? '1 sessão encerrada.' : `${revoked} sessões encerradas.`,
      );
      setOthersOpen(false);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao encerrar as outras sessões.'));
    }
  };

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Sessões ativas</h3>
          <p className="text-xs text-muted-foreground">
            Dispositivos com acesso à sua conta. Encerrar uma sessão desconecta
            aquele dispositivo na próxima ação dele.
          </p>
        </div>
        {outras > 0 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOthersOpen(true)}
          >
            <LogOut data-icon="inline-start" />
            Encerrar as outras
          </Button>
        )}
      </div>

      {isError ? (
        <p className="text-sm text-muted-foreground">
          Falha ao carregar as sessões.
        </p>
      ) : isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {(sessions ?? []).map((session) => (
            <li
              key={session.id}
              className="flex items-center justify-between gap-3 rounded-md border p-3"
            >
              <div className="flex min-w-0 items-center gap-3">
                <Laptop className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {session.device}
                    </span>
                    {session.current && (
                      <Badge variant="secondary">Esta sessão</Badge>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {[session.ip, `último uso ${formatRelativeTime(session.lastUsedAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              </div>
              {!session.current && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRevoking(session)}
                >
                  Encerrar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* ConfirmDialog participa da pilha `modal-stack`: o PerfilDialog é
          soterrado (mantendo o estado do formulário) e volta ao fechar. */}
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Encerrar esta sessão?"
        description={`“${revoking?.device}” perde o acesso na próxima ação. Será preciso entrar de novo naquele dispositivo.`}
        confirmLabel="Encerrar"
        pendingLabel="Encerrando…"
        destructive
        pending={revoke.isPending}
        onConfirm={() => void confirmRevoke()}
      />

      <ConfirmDialog
        open={othersOpen}
        onOpenChange={setOthersOpen}
        title="Encerrar as outras sessões?"
        description={`${outras === 1 ? '1 dispositivo' : `${outras} dispositivos`} perde o acesso na próxima ação. Esta sessão continua ativa.`}
        confirmLabel="Encerrar"
        pendingLabel="Encerrando…"
        destructive
        pending={revokeOthers.isPending}
        onConfirm={() => void confirmRevokeOthers()}
      />
    </div>
  );
}
```

**Modify**: `apps/web/src/features/perfil/PerfilDialog.tsx`

A seção entra no `DialogBody`, abaixo do formulário. O rodapé continua sendo o do formulário de perfil (o botão "Salvar" tem `form="perfil-form"`, então não conflita com os botões da lista).

```tsx
import { SessoesAtivas } from './SessoesAtivas';

// … dentro de <DialogBody>, depois do </form>:
              </Field>
            </form>
          )}

          <SessoesAtivas enabled={open} />
        </DialogBody>
```

E o `DialogDescription` passa a refletir o conteúdo:

```tsx
          <DialogDescription>
            Atualize seu nome e e-mail de acesso e veja os dispositivos com
            acesso à sua conta.
          </DialogDescription>
```

### Success Criteria

#### Automated Verification
- [x] `pnpm --filter web build` — o `tsc -b` passa (é o portão do frontend: não há suíte de testes)
- [x] `pnpm --filter web lint` — sem erros

#### Manual Verification
- [ ] Abrir Perfil com dois navegadores logados: a lista mostra os dois, com o rótulo do dispositivo, o IP e "último uso agora mesmo"; o atual traz o badge "Esta sessão" e **não** tem botão "Encerrar"
- [ ] Encerrar a outra sessão: o `ConfirmDialog` abre **por cima** do `PerfilDialog` sem empilhar dois modais (o de baixo é soterrado e volta intacto, com o formulário preenchido, ao fechar)
- [ ] Após confirmar, a linha some da lista e o outro navegador é levado ao login na ação seguinte
- [ ] Com três navegadores, "Encerrar as outras" deixa só o atual e o toast diz "2 sessões encerradas."
- [ ] Fechar e reabrir o Perfil: a lista é buscada de novo (a query só roda com o diálogo aberto)
- [ ] Editar o nome no formulário, abrir o `ConfirmDialog` de encerrar e cancelar: o nome digitado **continua lá**
- [ ] Tema claro e escuro: a lista usa tokens do design system, sem cor hard-coded

**⏸ PAUSE**: Fase 8A concluída. Confirmar antes de iniciar a Fase 8B.

---

## Testing Strategy

### Unit Tests

- `apps/api/src/modules/auth/auth.service.spec.ts` — instanciação direta com `SessionsService` mockado (padrão do repositório: `new Service(mockRepo)`, nunca `Test.createTestingModule`). Casos obrigatórios:
  - refresh com sessão inexistente, de outro usuário, revogada, expirada e com token já rotacionado → todos `401`;
  - refresh feliz rotaciona (`sessions.rotate`) e **não** cria sessão nova;
  - refresh de colaborador desativado → mensagem "Seu acesso ao CRM foi desativado";
  - login/register criam sessão com `tokenHash`;
  - `resetPassword` chama `revokeAll(userId)` sem exceção;
  - `logout` com `sid` chama `revoke`; sem `sid`, chama `revokeAll`.
- `apps/api/src/shared/user-agent.spec.ts` — teste puro da heurística, com ênfase na ordem (Edge/Opera se declaram Chrome; Chrome se declara Safari) e nos dois caminhos de reserva.

### Integration Tests

Não há suíte e2e no repositório (o `test:e2e` existe no `package.json` mas sem casos). A verificação de integração é o roteiro manual de cada fase, com dois ou três navegadores. Os pontos que **precisam** de olho humano por não terem cobertura automatizada:

- rotação de refresh preservando o `sid` ao longo de vários ciclos;
- revogação em cascata na desativação de colaborador;
- comportamento do cookie (`path`, `maxAge`) inalterado — o `setRefreshCookie` continua sendo o ponto único.

### Migration & Rollback

- **Aplicar**: `pnpm --filter api exec prisma migrate deploy`. A migration cria `Session` e faz `DROP COLUMN "refreshTokenHash"`.
- **Efeito colateral inevitável**: todos os usuários são deslogados no deploy. Não há backfill possível — um hash antigo não tem `sid` correspondente, e o refresh token antigo (payload sem `sid`) é rejeitado de propósito pelo controller. O frontend já trata `401` no refresh levando ao `/login` ([api.ts:52-55](../../apps/web/src/lib/api.ts#L52-L55)), então a experiência é "entrar de novo", não uma tela quebrada.
- **Rollback**: `ALTER TABLE "User" ADD COLUMN "refreshTokenHash" TEXT; DROP TABLE "Session";` e reverter o código. Também desloga todo mundo. Como as duas direções deslogam, o rollback é seguro em qualquer momento — não há dado de negócio em risco.
- **Ordem**: aplicar a migration **junto** com o deploy do código. Rodar a migration antes derruba a API antiga (que escreve numa coluna inexistente); rodar depois derruba a nova (que lê uma tabela inexistente). Como já há downtime de sessão, um deploy atômico (migração + imagem nova) é o caminho.

## Environment Considerations

- **CI/CD**: nenhum passo novo. A migration entra no `prisma migrate deploy` já existente.
- **Migrations**: uma, `20260728100000_sessions`. Sem RLS e sem `GRANT` explícito — o `ALTER DEFAULT PRIVILEGES` de [20260724040000_create_app_role](../../apps/api/prisma/migrations/20260724040000_create_app_role/migration.sql) já cobre tabelas criadas depois por `crm_user`. **Verificar em produção** com `\dp "Session"` que `crm_app` recebeu os quatro verbos; se o banco de produção foi provisionado fora das migrations, conceder à mão.
- **Config/Secrets**: nenhuma variável nova. `TRUST_PROXY_HOPS` já existe e é o que faz `req.ip` ser o IP real atrás do Traefik — se estiver errado, a coluna `ip` guardará o IP do proxy (dado inútil, não uma falha).
- **Multi-environment**: em desenvolvimento, sem proxy, `req.ip` costuma ser `::1` — esperado, não é bug.
- **LGPD**: IP e User-Agent são dado pessoal. Ficam visíveis **apenas** ao próprio usuário (a rota filtra por `userId`) e nunca vão para o log estruturado. Se um dia o owner puder ver sessões de colaboradores, isso vira uma decisão de privacidade, não de código.

## Dependencies & Risks

- **Deslogar todo mundo no deploy** — inevitável (ver Migration & Rollback). Programar para uma janela de baixo uso e avisar, se houver base ativa.
- **Access token sem `sid` durante a transição** — tokens emitidos antes do deploy sobrevivem até `JWT_ACCESS_TTL`. Nesse intervalo `CurrentSessionId` devolve `undefined`, e o `logout` cai no caminho "revoga todas" (comportamento antigo). É a degradação correta, e some sozinha.
- **Revogação não é instantânea** — o dispositivo revogado continua funcionando com o access token dele até expirar. A cópia da interface diz "na próxima ação" de propósito. Se isso virar requisito, o caminho é o `AccessGuard` validar `sid` contra `Session` na consulta que ele **já faz** por requisição ([access.service.ts](../../apps/api/src/modules/access/application/access.service.ts)) — mudança pequena, mas fora desta fase.
- **Heurística de User-Agent envelhece** — navegador novo cai no caminho de reserva (string crua). É degradação suave e o `user-agent.spec.ts` documenta o contrato.
- **Tabela `Session` cresce** — sem cron de expurgo, linhas revogadas/expiradas se acumulam. Volume desprezível na escala atual (uma linha por login), mas fica registrado como dívida junto com a retenção do `AuditLog` (Fase 8B).
- **Ordem entre planos**: 8A não depende de 8B nem de 8C, e é a de menor risco. Se a Fase 8B (auditoria) entrar depois, as revogações de sessão passam a ser auditáveis sem retrabalho — o `AuthService` já terá os pontos isolados.

## References

- PRD: `specs/research/2026-07-26-fase-8-sessoes-auditoria-lixeira.md`
- Planos irmãos: `specs/plans/2026-07-26-fase-8b-auditoria.md`, `specs/plans/2026-07-26-fase-8c-lixeira.md`
- Precedentes: `specs/plans/2026-07-25-colaboradores-e-papeis.md` (`:333` revogação ao desativar, `:343` extração do `setRefreshCookie`), `specs/research/2026-07-23-rls-por-ownerid.md:203` (`User` sem policy)
- Escopo declarado: [ROADMAP.md:235-255](../../ROADMAP.md)
- Externas: [OAuth2 — OWASP Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html) · [Refresh Token Rotation (Descope)](https://www.descope.com/blog/post/refresh-token-rotation) · [ua-parser-js AGPLv3 (Socket)](https://socket.dev/blog/ua-parser-js-drops-mit-license)
