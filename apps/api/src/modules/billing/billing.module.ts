import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { StripeService } from './application/stripe.service';
import { BillingService } from './application/billing.service';
import { SubscriptionAccessService } from './application/subscription-access.service';
import { BillingWebhookService } from './application/billing-webhook.service';
import { BillingController } from './api/billing.controller';
import { StripeWebhookController } from './api/stripe-webhook.controller';
import { SUBSCRIPTION_REPOSITORY } from './domain/subscription.repository';
import { PrismaSubscriptionRepository } from './infra/prisma-subscription.repository';

@Module({
  imports: [UsersModule],
  controllers: [BillingController, StripeWebhookController],
  providers: [
    StripeService,
    BillingService,
    SubscriptionAccessService,
    BillingWebhookService,
    {
      provide: SUBSCRIPTION_REPOSITORY,
      useClass: PrismaSubscriptionRepository,
    },
  ],
  // Exporta o que o BillingGuard global (Phase 4) precisa injetar.
  exports: [StripeService, SubscriptionAccessService],
})
export class BillingModule {}
