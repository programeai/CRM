import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from './public.decorator';

type AuthedRequest = Request & { user: { sub: string; sid?: string } };

/** O que um ACCESS TOKEN carrega. Ver a nota sobre `sid`/`tipo` no guard. */
interface PayloadDeAcesso {
  sub: string;
  sid?: string;
  /** Presente só em token de OUTRO propósito (hoje: o desafio de 2FA). */
  tipo?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    private config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const [type, token] = req.headers.authorization?.split(' ') ?? [];
    if (type !== 'Bearer' || !token) throw new UnauthorizedException();
    let payload: PayloadDeAcesso;
    try {
      payload = await this.jwt.verifyAsync<PayloadDeAcesso>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }
    /*
      **Assinatura válida não basta: o token tem de ser um token de SESSÃO.**

      `JWT_ACCESS_SECRET` assina mais de uma coisa — desde a Fase 19-B ele também
      assina o desafio de segundo fator, emitido DEPOIS da senha e ANTES do
      código. Sem esta checagem aquele desafio abriria qualquer rota autenticada, e
      o segundo fator viraria decoração: bastaria acertar a senha e usar o desafio
      como Bearer. Um e2e trava isso (`GET /auth/me` com o desafio → 401).

      Duas condições, e cada uma sozinha já fecharia o caso:
       - `tipo` ausente — só token de outro propósito o carrega;
       - `sid` presente — todo access token nasce amarrado a uma sessão em
         `issueTokens`, e é o `sid` que o logout e o "revogar esta sessão" usam.
    */
    if (payload.tipo !== undefined || !payload.sid) {
      throw new UnauthorizedException();
    }
    req.user = { sub: payload.sub, sid: payload.sid };
    return true;
  }
}
