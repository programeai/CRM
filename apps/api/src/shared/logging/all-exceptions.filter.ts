/**
 * Filtro global de exceções: garante que **nenhum erro inesperado passe calado**.
 *
 * O log que mais falta na hora de investigar é o do erro que ninguém imaginou —
 * sem isso, um `TypeError` num service vira só um 500 seco no log de acesso, sem
 * stack e sem pista. Aqui ele sai como `evento: "erro.nao_tratado"` com stack,
 * rota e `requestId`.
 *
 * Exceções HTTP (as `NotFoundException`, `ConflictException` e afins lançadas de
 * propósito pelas regras de negócio) mantêm exatamente a resposta que o Nest já
 * dava — são fluxo normal, não incidente, e por isso só o log de acesso as
 * registra (com `level=warn`, pelo status 4xx).
 */
import {
  Catch,
  HttpException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { registrarLog } from './log';

const STATUS_ERRO_INTERNO = 500;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : STATUS_ERRO_INTERNO;

    // 5xx é sempre falha nossa, mesmo quando embalada num HttpException.
    if (status >= STATUS_ERRO_INTERNO) {
      registrarLog('error', {
        evento: 'erro.nao_tratado',
        msg:
          exception instanceof Error
            ? exception.message
            : 'Exceção sem mensagem.',
        tipo:
          exception instanceof Error
            ? exception.constructor.name
            : typeof exception,
        stack: exception instanceof Error ? exception.stack : undefined,
        metodo: req.method,
        rota: req.path,
        status,
      });
    }

    // A resposta pode já ter começado (ex.: erro durante um stream). Aí não há o
    // que responder — o log acima é o registro que sobra.
    if (res.headersSent) return;

    if (exception instanceof HttpException) {
      const corpo = exception.getResponse();
      res
        .status(status)
        .json(
          typeof corpo === 'string'
            ? { statusCode: status, message: corpo }
            : corpo,
        );
      return;
    }

    // Erro não previsto: nada do interno vaza para o cliente, e a mensagem é
    // pt-BR (o padrão do Nest aqui é "Internal server error").
    res.status(status).json({
      statusCode: status,
      message: 'Erro interno do servidor.',
    });
  }
}
