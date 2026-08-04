import type { OwnerWebhook, Prisma } from '@prisma/client';

export const OWNER_WEBHOOK_REPOSITORY = Symbol('OWNER_WEBHOOK_REPOSITORY');

/**
 * Uma entrega reservada pela varredura, já com o que o POST precisa. `url` e
 * `secret` vêm do JOIN com o webhook: a alternativa seria uma segunda consulta
 * por entrega.
 */
export interface PendingWebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payload: unknown;
  attempts: number;
  url: string;
  secret: string;
  active: boolean;
}

export interface OwnerWebhookRepository {
  findManyByOwner(ownerId: string): Promise<OwnerWebhook[]>;
  findById(ownerId: string, id: string): Promise<OwnerWebhook | null>;
  create(data: {
    ownerId: string;
    name: string;
    url: string;
    secret: string;
    events: string[];
  }): Promise<OwnerWebhook>;
  update(
    ownerId: string,
    id: string,
    data: Prisma.OwnerWebhookUpdateInput,
  ): Promise<OwnerWebhook | null>;
  /** Troca o segredo da MESMA linha. A assinatura anterior morre na hora. */
  replaceSecret(
    ownerId: string,
    id: string,
    secret: string,
  ): Promise<OwnerWebhook | null>;
  delete(ownerId: string, id: string): Promise<void>;
  /** Marca a última entrega bem-sucedida. Client admin (roda no cron). */
  touchPeloSistema(id: string): Promise<void>;

  /**
   * Os webhooks ATIVOS e verificados do owner que assinaram este evento. É o
   * filtro que decide quem recebe — no caminho do request (`prisma.db`).
   */
  findAtivosPorEvento(ownerId: string, evento: string): Promise<OwnerWebhook[]>;
  /** Idem, pelo client admin — o cron não tem `app.owner_id`. */
  findAtivosPorEventoPeloSistema(
    ownerId: string,
    evento: string,
  ): Promise<OwnerWebhook[]>;

  // --- outbox ---
  /** Enfileira N entregas dentro da transação do request. */
  enfileirar(
    entregas: Prisma.OwnerWebhookDeliveryUncheckedCreateInput[],
  ): Promise<void>;
  /** Idem, pelo client admin (cron cross-owner). */
  enfileirarPeloSistema(
    entregas: Prisma.OwnerWebhookDeliveryUncheckedCreateInput[],
  ): Promise<void>;
  /** Reserva um lote de pendentes, atomicamente. Ver a implementação. */
  reservarPendentes(now: Date, take: number): Promise<PendingWebhookDelivery[]>;
  marcarEnviada(id: string, quando: Date): Promise<void>;
  marcarFalha(
    id: string,
    attempts: number,
    proxima: Date | null,
    erro: string,
  ): Promise<void>;
}
