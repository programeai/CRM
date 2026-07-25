import { Inject, Injectable, Logger } from '@nestjs/common';
import type Stripe from 'stripe';
import { StripeService } from './stripe.service';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
  type SubscriptionStatusValue,
} from '../domain/subscription.repository';

/**
 * Processa os eventos do Stripe e mantém o `Subscription` local em sincronia.
 * Roda sem contexto de owner (webhook público) → o repositório resolve o owner
 * pelo `stripeCustomerId` do evento, via client admin (bypassa RLS).
 * Idempotente: upsert por `stripeCustomerId`; eventos repetidos são seguros.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private readonly stripe: StripeService,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly repo: SubscriptionRepository,
  ) {}

  async process(event: Stripe.Event): Promise<void> {
    switch (event.type) {
      case 'checkout.session.completed': {
        // Ao concluir o Checkout, busca a assinatura para gravar o status correto.
        const session = event.data.object;
        const subId =
          typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const sub = await this.stripe.client.subscriptions.retrieve(subId);
          await this.syncSubscription(sub);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await this.syncSubscription(event.data.object);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await this.repo.upsertByStripeCustomerId(this.customerId(sub), {
          status: 'CANCELED',
          stripeSubscriptionId: sub.id,
          cancelAtPeriodEnd: sub.cancel_at_period_end,
        });
        break;
      }
      default:
        this.logger.debug({
          evento: 'billing.webhook_ignorado',
          msg: 'Evento do Stripe sem tratamento nesta versão.',
          tipoStripe: event.type,
        });
    }
  }

  /** Mapeia uma `Stripe.Subscription` para o snapshot local e persiste. */
  private async syncSubscription(sub: Stripe.Subscription): Promise<void> {
    await this.repo.upsertByStripeCustomerId(this.customerId(sub), {
      status: this.mapStatus(sub.status),
      stripeSubscriptionId: sub.id,
      trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      currentPeriodEnd: this.periodEnd(sub),
      cancelAtPeriodEnd: sub.cancel_at_period_end,
    });
  }

  private customerId(sub: Stripe.Subscription): string {
    return typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  }

  /**
   * `current_period_end` deixou o objeto Subscription (API 2025) e vive nos
   * itens da assinatura — pega o maior fim de período entre os itens.
   */
  private periodEnd(sub: Stripe.Subscription): Date | null {
    const ends = sub.items?.data
      ?.map((item) => item.current_period_end)
      .filter((v): v is number => typeof v === 'number');
    if (!ends || ends.length === 0) return null;
    return new Date(Math.max(...ends) * 1000);
  }

  private mapStatus(
    status: Stripe.Subscription.Status,
  ): SubscriptionStatusValue {
    switch (status) {
      case 'trialing':
        return 'TRIALING';
      case 'active':
        return 'ACTIVE';
      case 'past_due':
      case 'unpaid':
        return 'PAST_DUE';
      case 'incomplete':
        return 'INCOMPLETE';
      case 'canceled':
      case 'incomplete_expired':
      case 'paused':
      default:
        return 'CANCELED';
    }
  }
}
