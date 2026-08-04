import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * O que a autenticação da API pública descobriu. O `ownerId` sai daqui e de mais
 * nenhum lugar — em especial, **nunca** do corpo da requisição
 * (`PrismaService.executarComoOwner`, obrigação 1).
 */
export interface ContextoDaApi {
  ownerId: string;
  keyId: string;
  /** Nome da chave. Vira `actorName` na trilha de auditoria. */
  keyName: string;
}

export const API_CONTEXT = 'integracaoDaApi';

/** Requisição depois do `PublicApiKeyGuard`. */
export interface RequisicaoDaApi extends Request {
  [API_CONTEXT]?: ContextoDaApi;
}

/** Publicado pelo guard, lido pelo controller. Fail-closed se o guard sair. */
export const ApiContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ContextoDaApi => {
    const req = ctx.switchToHttp().getRequest<RequisicaoDaApi>();
    const contexto = req[API_CONTEXT];
    if (!contexto) {
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    return contexto;
  },
);
