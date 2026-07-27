import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannelKind } from '@prisma/client';
import { MailService } from '../../../mail/mail.service';
import { notificationEmail } from '../../../mail/templates/notification.template';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';

/**
 * Canal de e-mail. `isEnabled()` delega ao `MailService`, que já implementa o
 * contrato de "serviço opcional": sem `SMTP_HOST`, o canal é desligado e o
 * dispatch marca a entrega como SKIPPED — não como falha, e sem retry.
 */
@Injectable()
export class EmailChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'EMAIL';

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  isEnabled(): boolean {
    return this.mail.isEnabled();
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { email } = destino.config as { email?: string };
    if (!email) throw new Error('Destino de e-mail sem endereço configurado.');
    const appUrl = this.config.get<string>('FRONTEND_URL') ?? '';
    const r = await this.mail.sendNotification(
      email,
      notificationEmail({ conteudo, appUrl }),
    );
    // `disabled` só chega aqui numa corrida (isEnabled passou e a config sumiu).
    if (r.status !== 'sent') {
      throw new Error('SMTP indisponível no momento do envio.');
    }
  }
}
