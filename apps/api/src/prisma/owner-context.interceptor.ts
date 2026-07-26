import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Observable, from, lastValueFrom } from 'rxjs';
import { PrismaService, PRISMA_TX } from './prisma.service';
import type { AuthenticatedRequest } from '../modules/access/domain/access-context';

/**
 * Abre uma transação por requisição autenticada, seta `app.owner_id` como
 * primeira statement e guarda o `tx` no CLS — os repositórios acessam esse
 * `tx` via `PrismaService.db`, de modo que todo o handler roda sob o contexto
 * de RLS do usuário logado.
 *
 * O valor do GUC é o **owner da workspace** (`req.access.ownerId`, resolvido
 * pelo `AccessGuard`), não o id de quem está logado: é isso que faz o
 * colaborador ler e escrever exatamente as linhas do owner que o convidou. No
 * owner os dois coincidem.
 *
 * Rotas públicas (login/register/refresh/oauth/convite) não têm `req.user`:
 * passam direto, sem transação. Elas só tocam tabelas sem RLS (User/OAuthAccount)
 * ou usam o client admin explicitamente; qualquer tabela com RLS acessada sem
 * owner responde fail-closed. Manter essas rotas fora da transação evita
 * segurá-la aberta durante o I/O externo do OAuth (troca de token com o provedor).
 */
@Injectable()
export class OwnerContextInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const ownerId = req.access?.ownerId ?? req.user?.sub;

    // Sem usuário autenticado (rota pública) → sem transação de contexto.
    if (!ownerId) return next.handle();

    return from(
      this.prisma.$transaction(async (tx) => {
        // set_config seguro: valor via bound param (nunca concatenar/interpolar).
        await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
        this.cls.set(PRISMA_TX, tx);
        const result: unknown = await lastValueFrom(next.handle());
        return result;
      }),
    );
  }
}
