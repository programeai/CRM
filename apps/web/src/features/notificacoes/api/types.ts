import type {
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_CHANNEL_KIND_LABELS,
  AUDIT_ENTITY_LABELS,
} from '@/lib/labels';

/** O map de rótulos é também a fonte do tipo — mesmo padrão da auditoria. */
export type NotificationType = keyof typeof NOTIFICATION_TYPE_LABELS;
export type NotificationEntity = keyof typeof AUDIT_ENTITY_LABELS;
export type NotificationChannelKind =
  keyof typeof NOTIFICATION_CHANNEL_KIND_LABELS;

export interface Notificacao {
  /** Id da ENTREGA — é ele que "marcar como lida" recebe. */
  id: string;
  type: NotificationType;
  entity: NotificationEntity;
  entityId: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

/** Um destino de notificação do usuário, como a API o devolve. */
export interface DestinoDeNotificacao {
  id: string;
  kind: NotificationChannelKind;
  label: string;
  /**
   * Resumo da config — a API **nunca** devolve a config crua. `null` no `IN_APP`,
   * o endereço no `EMAIL`, e só o host no `WEBHOOK`/`SLACK` (a URL é o segredo).
   */
  configResumo: string | null;
  types: NotificationType[];
  verified: boolean;
  active: boolean;
  createdAt: string;
}

export interface CriarDestinoBody {
  label: string;
  email: string;
  types?: NotificationType[];
}

export interface AtualizarDestinoBody {
  label?: string;
  active?: boolean;
  types?: NotificationType[];
}

/**
 * Destino de integração. Exige `notificacao:integrar` e nasce **não verificado e
 * inativo** — só entrega depois do ping de `POST /targets/:id/verify`.
 */
export interface CriarIntegracaoBody {
  label: string;
  kind: 'WEBHOOK' | 'SLACK' | 'DISCORD';
  url: string;
  types?: NotificationType[];
}
