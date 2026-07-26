/**
 * Contexto e log de acesso de cada requisição HTTP.
 *
 * Duas responsabilidades, deliberadamente juntas porque compartilham o mesmo id:
 *
 * 1. **`requestId`** — lê o cabeçalho `x-request-id` (ou gera um), devolve-o na
 *    resposta e o deixa no cabeçalho da requisição, de onde o `idGenerator` do
 *    CLS (ver `AppModule`) o copia para o contexto. Assim toda linha de log
 *    daquele acesso — inclusive as dos services — sai com o mesmo `requestId`, e
 *    quem relata um erro pode informar o id que veio na resposta.
 * 2. **Log de acesso** — uma linha por requisição, emitida no `finish` da
 *    resposta. É middleware de nível Express (registrado em `main.ts` antes de
 *    tudo) justamente para cobrir o que nunca chega ao handler: 401 do
 *    `JwtAuthGuard`, 429 do throttler, 404 de rota inexistente.
 */
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { registrarLog, type NivelLog } from './log';

export const CABECALHO_REQUEST_ID = 'x-request-id';

/**
 * O healthcheck do container bate a cada 30s e nunca é o que se investiga —
 * ficaria 2.880 linhas/dia empurrando o resto para fora da retenção.
 */
const ROTAS_SILENCIOSAS = new Set(['/api/v1/health']);

/**
 * O id vem de fora (Traefik, front, curl) e vai para o log: aceite só o que é
 * inofensivo e curto, senão gere um novo.
 */
const ID_ACEITAVEL = /^[\w.:-]{8,64}$/;

function requestIdDaRequisicao(req: Request): string {
  const recebido = req.headers[CABECALHO_REQUEST_ID];
  return typeof recebido === 'string' && ID_ACEITAVEL.test(recebido)
    ? recebido
    : randomUUID();
}

function nivelPeloStatus(status: number): NivelLog {
  if (status >= 500) return 'error';
  if (status >= 400) return 'warn';
  return 'info';
}

export function contextoDaRequisicao(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = requestIdDaRequisicao(req);
  req.headers[CABECALHO_REQUEST_ID] = requestId;
  res.setHeader(CABECALHO_REQUEST_ID, requestId);

  if (ROTAS_SILENCIOSAS.has(req.path)) {
    next();
    return;
  }

  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - inicio) / 1e6;
    registrarLog(nivelPeloStatus(res.statusCode), {
      evento: 'http.requisicao',
      requestId,
      metodo: req.method,
      // Só o caminho, nunca a query string: ela carrega o `code` do OAuth e
      // outros valores que não podem ir para o log.
      rota: req.path,
      status: res.statusCode,
      ms: Math.round(ms),
      // Definido pelo JwtAuthGuard quando a rota é autenticada.
      usuarioId: (req as Request & { user?: { sub?: string } }).user?.sub,
      // req.ip já é o IP do cliente: o bootstrap configura `trust proxy` a partir
      // de TRUST_PROXY_HOPS (ver main.ts), então o Express deriva do
      // `x-forwarded-for` escrito pelo proxy. É o mesmo valor que o rate limit usa.
      ip: req.ip,
      ua: req.headers['user-agent'],
    });
  });

  next();
}
