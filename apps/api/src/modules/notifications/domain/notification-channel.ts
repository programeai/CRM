import type {
  NotificationChannelKind,
  NotificationType,
  Prisma,
} from '@prisma/client';

/** Token do array-provider dos canais. Ver o comentário do NotificationsModule. */
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS');

/** Um destino concreto, como o adapter precisa vê-lo. */
export interface DestinoDeNotificacao {
  id: string;
  kind: NotificationChannelKind;
  /** `{}` no IN_APP, `{ email }` no EMAIL, `{ url }` no WEBHOOK/SLACK. */
  config: Prisma.JsonValue;
}

/**
 * Conteúdo neutro: o que aconteceu, em pt-BR, SEM formato de destino nenhum.
 * `corpo` é texto puro. Se algum dia aparecer HTML aqui, a costura quebrou.
 */
export interface ConteudoDeNotificacao {
  tipo: NotificationType;
  titulo: string;
  corpo: string;
  /** Caminho relativo no front (`/propostas/<id>`); o adapter prefixa o host. */
  link: string | null;
  dados: Record<string, unknown> | null;
  /** Id da entrega. Vira `X-CRM-Delivery` no webhook — é o que permite dedupe. */
  deliveryId: string;
}

/**
 * Porta única de entrega. Um adapter por destino, em `infra/`.
 *
 * `entregar` **rejeita** quando falha — é o que alimenta o retry/backoff e o
 * `NotificationDelivery.status`. Adapter que engole a exceção torna o status
 * decorativo (foi exatamente o problema do `MailService`, ver Fase 4).
 */
export interface CanalDeNotificacao {
  readonly kind: NotificationChannelKind;
  /** Contrato de "serviço opcional" (MailService/CaptchaService): sem config, desligado. */
  isEnabled(): boolean;
  entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void>;
}
