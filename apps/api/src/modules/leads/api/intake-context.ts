import {
  createParamDecorator,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * O que a autenticação da ingestão descobriu. O `ownerId` sai daqui e de mais
 * nenhum lugar — em especial, nunca do corpo da requisição
 * (`PrismaService.executarComoOwner`, obrigação 1).
 */
export interface ContextoDeIntegracao {
  ownerId: string;
  /** `null` no caminho legado: token de ambiente não tem canal nem chave. */
  keyId: string | null;
}

export const INTAKE_CONTEXT = 'integracaoDaIngestao';

/** Requisição depois do guard da ingestão. */
export interface RequisicaoDeIngestao extends Request {
  [INTAKE_CONTEXT]?: ContextoDeIntegracao;
}

/** Publicado pelo guard, lido pelo controller. */
export const IntakeContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ContextoDeIntegracao => {
    const req = ctx.switchToHttp().getRequest<RequisicaoDeIngestao>();
    const contexto = req[INTAKE_CONTEXT];
    if (!contexto) {
      // Só acontece se a rota perder o guard — e aí ela não pode gravar nada.
      throw new UnauthorizedException('Chave de integração inválida.');
    }
    return contexto;
  },
);
