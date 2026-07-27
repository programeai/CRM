import { Injectable } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import type { CanalDeNotificacao } from '../domain/notification-channel';

/**
 * Canal in-app. Por **D1** o in-app é um canal como os outros, não um caminho
 * privilegiado: a central é `Notification ⋈ NotificationDelivery(kind='IN_APP')`
 * e o `readAt` mora na entrega.
 *
 * `entregar` é um no-op que sucede — para o in-app, **existir na tabela É a
 * entrega**. O job só vira o status para `SENT`, e a central lê por `kind`, sem
 * filtrar por status: a notificação aparece no sino no instante do commit, não
 * um minuto depois. O adapter existe mesmo assim, para que o registry não tenha
 * exceção e "desligar o in-app" seja desativar um destino como qualquer outro.
 */
@Injectable()
export class InAppChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'IN_APP';

  isEnabled(): boolean {
    return true;
  }

  // Parâmetros ignorados de propósito — este canal não usa destino nem
  // conteúdo (ver o comentário da classe). TS aceita a assinatura mais curta
  // como implementação de `CanalDeNotificacao.entregar`.
  entregar(): Promise<void> {
    return Promise.resolve();
  }
}
