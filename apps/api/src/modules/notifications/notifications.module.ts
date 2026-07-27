import { Global, Module } from '@nestjs/common';
import { MailModule } from '../../mail/mail.module';
import { NotificationsService } from './notifications.service';
import { NotificationsQueryService } from './application/notifications-query.service';
import { NotificationTargetsService } from './application/notification-targets.service';
import { NotificationsDigestJob } from './application/notifications-digest.job';
import { EmailChannel } from './infra/email.channel';
import { WebhookChannel } from './infra/webhook.channel';
import { SlackChannel } from './infra/slack.channel';
import { DiscordChannel } from './infra/discord.channel';
import { TelegramChannel } from './infra/telegram.channel';
import { NotificationsDispatcherService } from './application/notifications-dispatcher.service';
import { NotificationsDispatchJob } from './application/notifications-dispatch.job';
import { NotificationsRemindersJob } from './application/notifications-reminders.job';
import { NotificationsController } from './api/notifications.controller';
import {
  NOTIFICATION_CHANNELS,
  type CanalDeNotificacao,
} from './domain/notification-channel';
import { NOTIFICATION_REPOSITORY } from './domain/notification.repository';
import { NOTIFICATION_TARGET_REPOSITORY } from './domain/notification-target.repository';
import { NOTIFICATION_TRIGGERS_REPOSITORY } from './domain/notification-triggers.repository';
import { PrismaNotificationRepository } from './infra/prisma-notification.repository';
import { PrismaNotificationTargetRepository } from './infra/prisma-notification-target.repository';
import { PrismaNotificationTriggersRepository } from './infra/prisma-notification-triggers.repository';
import { InAppChannel } from './infra/in-app.channel';

/**
 * Global pelo mesmo motivo do `AuditModule`: a **emissão** é transversal e cruza
 * módulos que não têm (nem devem ter) dependência entre si — clients, pipeline,
 * projects, activities, finance, proposals. Exporta **só** o `NotificationsService`:
 * a leitura (controller + repositórios) é assunto interno deste módulo.
 *
 * Exceção: `NOTIFICATION_TARGET_REPOSITORY` também é exportado, porque o
 * provisionamento dos destinos padrão nasce fora deste módulo (`UsersService`,
 * `InvitesService`) — não há como provisionar sem o token.
 *
 * O array-provider `NOTIFICATION_CHANNELS` é **padrão novo no repo** — não há um
 * único `useFactory` em `apps/` hoje, e os providers não-triviais são todos
 * `useClass`. Foi escolhido conscientemente: o Nest não tem multi-injeção por
 * token (como o Angular), e esta é a forma idiomática de compor a lista sem
 * biblioteca. O ganho é o contrato desta fase — **plugar um canal novo é 1
 * arquivo em `infra/` + 1 linha no `inject` abaixo**, e o `if`/`switch` por canal
 * fica PROIBIDO fora do `Map` do `NotificationsDispatcherService`.
 *
 * Os adapters precisam estar **também** em `providers`: é de lá que o `inject`
 * os resolve.
 */
@Global()
@Module({
  // `MailModule` **não** é `@Global()` (5 linhas, sem o decorator), então precisa
  // ser importado explicitamente — é dele que saem o `EmailChannel` e o digest.
  imports: [MailModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsQueryService,
    NotificationTargetsService,
    NotificationsDispatcherService,
    NotificationsDispatchJob,
    NotificationsRemindersJob,
    NotificationsDigestJob,
    InAppChannel,
    EmailChannel,
    WebhookChannel,
    SlackChannel,
    DiscordChannel,
    TelegramChannel,
    {
      provide: NOTIFICATION_CHANNELS,
      useFactory: (...canais: CanalDeNotificacao[]) => canais,
      inject: [
        InAppChannel,
        EmailChannel,
        WebhookChannel,
        SlackChannel,
        DiscordChannel,
        TelegramChannel,
      ],
    },
    {
      provide: NOTIFICATION_REPOSITORY,
      useClass: PrismaNotificationRepository,
    },
    {
      provide: NOTIFICATION_TARGET_REPOSITORY,
      useClass: PrismaNotificationTargetRepository,
    },
    {
      provide: NOTIFICATION_TRIGGERS_REPOSITORY,
      useClass: PrismaNotificationTriggersRepository,
    },
  ],
  exports: [NotificationsService, NOTIFICATION_TARGET_REPOSITORY],
})
export class NotificationsModule {}
