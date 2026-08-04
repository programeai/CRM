import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { API_CONTEXT, type RequisicaoDaApi } from './api-context';

/**
 * Rate limit **por chave**, e não por IP. O `getTracker` default do
 * `ThrottlerGuard` devolve `req.ip`, o que na API pública é o balde errado: dez
 * integrações atrás do mesmo NAT compartilhariam o teto, e uma chave abusiva
 * atrás de IP rotativo escaparia dele.
 *
 * Registrado **no nível da rota**, depois do `PublicApiKeyGuard` — guards de
 * rota rodam na ordem em que são declarados, e o contexto da chave só existe
 * depois do primeiro. O `ThrottlerGuard` global continua valendo por IP: os dois
 * baldes convivem porque o `generateKey` inclui o tracker.
 *
 * **Nota operacional:** o storage do `@nestjs/throttler` é em memória, e o
 * deploy é instância única por construção (`container_name: crm-api` fixo, sem
 * `deploy.replicas`). Ligar réplicas sem trocar o storage por Redis multiplica o
 * teto pelo número de réplicas, em silêncio.
 */
@Injectable()
export class PublicApiThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: RequisicaoDaApi): Promise<string> {
    const keyId = req[API_CONTEXT]?.keyId;
    // Sem contexto o guard anterior já recusou; o fallback existe para não
    // transformar uma falha de ordem de guards num balde global.
    return Promise.resolve(
      keyId ? `chave:${keyId}` : `ip:${req.ip ?? 'desconhecido'}`,
    );
  }
}
