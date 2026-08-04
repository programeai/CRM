import { Global, Module } from '@nestjs/common';
import { OwnerWebhooksController } from './api/owner-webhooks.controller';
import { OwnerWebhooksService } from './application/owner-webhooks.service';
import { OwnerWebhooksEmitterService } from './application/owner-webhooks-emitter.service';
import { OwnerWebhooksDispatcherService } from './application/owner-webhooks-dispatcher.service';
import { OwnerWebhooksDispatchJob } from './application/owner-webhooks-dispatch.job';
import { OWNER_WEBHOOK_REPOSITORY } from './domain/owner-webhook.repository';
import { PrismaOwnerWebhookRepository } from './infra/prisma-owner-webhook.repository';

/**
 * Global pelo mesmo motivo do `NotificationsModule` e do `AuditModule`: a
 * **emissão** é transversal e cruza módulos que não têm (nem devem ter)
 * dependência entre si — clients, pipeline, projects, activities, finance,
 * proposals, leads.
 *
 * Exporta **só** o `OwnerWebhooksEmitterService`: o CRUD (controller, service e
 * repositório) e a entrega são assunto interno deste módulo.
 */
@Global()
@Module({
  controllers: [OwnerWebhooksController],
  providers: [
    OwnerWebhooksService,
    OwnerWebhooksEmitterService,
    OwnerWebhooksDispatcherService,
    OwnerWebhooksDispatchJob,
    {
      provide: OWNER_WEBHOOK_REPOSITORY,
      useClass: PrismaOwnerWebhookRepository,
    },
  ],
  exports: [OwnerWebhooksEmitterService],
})
export class WebhooksModule {}
