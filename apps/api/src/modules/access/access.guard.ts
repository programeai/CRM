import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { permissionMeta, type PermissionKey } from '../../shared/permissions';
import { AccessService } from './application/access.service';
import { REQUIRE_PERMISSION_KEY } from './require-permission.decorator';
import type { AuthenticatedRequest } from './domain/access-context';

/**
 * Registrado como `APP_GUARD` **entre** o `JwtAuthGuard` (que popula `req.user`)
 * e o `BillingGuard` (que consome `req.access.ownerId`). Faz duas coisas:
 *
 *  1. Publica `req.access` — a workspace (`ownerId`) e as permissões efetivas.
 *     É a partir dele que o `OwnerContextInterceptor` seta `app.owner_id`, de
 *     modo que o colaborador lê e escreve exatamente as linhas do seu owner.
 *  2. Aplica o `@RequirePermission()` da rota (OU entre as chaves).
 *
 * Rotas `@Public()` passam sem contexto — elas só tocam tabelas sem RLS (ou
 * usam o client admin explicitamente, como o aceite de convite).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = req.user?.sub;
    // Rota protegida sem usuário não deveria chegar aqui (JwtAuthGuard barra antes).
    if (!userId) throw new UnauthorizedException();

    const access = await this.access.resolve(userId);
    // Conta apagada ou colaborador desativado: a sessão deixa de valer agora,
    // sem esperar o access token expirar.
    if (!access) {
      throw new UnauthorizedException(
        'Sua sessão não é mais válida. Entre novamente.',
      );
    }
    req.access = access;

    const required = this.reflector.getAllAndOverride<PermissionKey[]>(
      REQUIRE_PERMISSION_KEY,
      targets,
    );
    if (!required?.length) return true;

    if (!required.some((key) => access.permissions.includes(key))) {
      // A mensagem cita o rótulo da primeira chave exigida — a que descreve a
      // ação principal da rota.
      throw new ForbiddenException(
        `Você não tem permissão para ${permissionMeta(required[0]).label.toLowerCase()}.`,
      );
    }
    return true;
  }
}
