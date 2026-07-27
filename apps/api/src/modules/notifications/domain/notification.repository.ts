import type {
  NotificationChannelKind,
  Notification,
  NotificationDelivery,
  Prisma,
} from '@prisma/client';

export const NOTIFICATION_REPOSITORY = Symbol('NOTIFICATION_REPOSITORY');

/** Linha da central: a entrega IN_APP com o conteúdo da notificação junto. */
export type InboxItem = NotificationDelivery & { notification: Notification };

export interface InboxFilter {
  ownerId: string;
  userId: string;
  unreadOnly?: boolean;
  skip: number;
  take: number;
}

/** Entrega pendente, com tudo que o dispatch precisa — sem segunda ida ao banco. */
export type PendingDelivery = NotificationDelivery & {
  notification: Notification;
  target: {
    id: string;
    kind: NotificationChannelKind;
    config: Prisma.JsonValue;
  } | null;
};

export interface NotificationRepository {
  /** Cria a notificação e as entregas num único create aninhado (request, `prisma.db`). */
  criar(data: Prisma.NotificationUncheckedCreateInput): Promise<Notification>;
  /** Idem, pelo client admin — cron cross-owner, sem `app.owner_id`. */
  criarPeloSistema(
    data: Prisma.NotificationUncheckedCreateInput,
  ): Promise<Notification>;
  /** Das chaves informadas, quais JÁ existem para o usuário (pré-filtro de dedupe). */
  dedupeKeysExistentes(userId: string, chaves: string[]): Promise<Set<string>>;

  findInboxAndCount(
    filter: InboxFilter,
  ): Promise<{ data: InboxItem[]; total: number }>;
  contarNaoLidas(ownerId: string, userId: string): Promise<number>;
  /** Marca UMA entrega IN_APP como lida. Devolve false se não é do usuário. */
  marcarLida(
    ownerId: string,
    userId: string,
    deliveryId: string,
  ): Promise<boolean>;
  /** Marca todas as não lidas do usuário. Devolve quantas. */
  marcarTodasLidas(ownerId: string, userId: string): Promise<number>;

  /**
   * Notificações do usuário emitidas desde `desde` — o insumo do digest.
   * Cross-owner pelo client admin (o cron não tem `app.owner_id`).
   */
  findParaDigestPeloSistema(
    ownerId: string,
    userId: string,
    desde: Date,
  ): Promise<Notification[]>;

  // --- outbox (client admin, cross-owner) ---
  findPendentes(now: Date, take: number): Promise<PendingDelivery[]>;
  marcarEnviada(id: string, sentAt: Date): Promise<void>;
  marcarPulada(id: string, motivo: string): Promise<void>;
  marcarFalha(
    id: string,
    attempts: number,
    nextAttemptAt: Date | null,
    erro: string,
  ): Promise<void>;
}
