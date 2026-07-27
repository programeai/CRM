import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type {
  AccessContext,
  AuthenticatedRequest,
} from '../modules/access/domain/access-context';

/**
 * Id do **usuário autenticado** (`req.user.sub`), populado pelo `JwtAuthGuard`.
 * Use em operações de identidade: perfil, senha, logout. Para escopo de dados
 * (tudo que é filtrado por `ownerId`), use `@CurrentOwnerId()`.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    return req.user!.sub!;
  },
);

/**
 * Id do **owner da workspace** (`req.access.ownerId`), resolvido pelo
 * `AccessGuard`. É o eixo de isolamento de todos os dados de negócio: no owner
 * coincide com o próprio id; no colaborador é o id de quem o convidou — o mesmo
 * valor que o RLS recebe em `app.owner_id`.
 */
export const CurrentOwnerId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    return currentAccess(ctx).ownerId;
  },
);

/** Contexto de acesso inteiro (workspace + permissões) — ex.: `GET /auth/me`. */
export const CurrentAccess = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessContext => {
    return currentAccess(ctx);
  },
);

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

function currentAccess(ctx: ExecutionContext): AccessContext {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.access) {
    // Só acontece se a rota for @Public() (o AccessGuard não resolve contexto)
    // ou se a ordem dos guards no AppModule for alterada.
    throw new InternalServerErrorException(
      'Contexto de acesso ausente na requisição.',
    );
  }
  return req.access;
}
