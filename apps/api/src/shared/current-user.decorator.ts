import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/** Extrai o id do usuário autenticado (req.user.sub), populado pelo JwtAuthGuard global. */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user: { sub: string } }>();
    return req.user.sub;
  },
);
