import {
  BadRequestException,
  Controller,
  Headers,
  Post,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type Stripe from 'stripe';
import { Public } from '../../auth/public.decorator';
import { AllowWithoutSubscription } from '../allow-without-subscription.decorator';
import { StripeService } from '../application/stripe.service';
import { BillingWebhookService } from '../application/billing-webhook.service';

@AllowWithoutSubscription()
@Controller('billing')
export class StripeWebhookController {
  constructor(
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
    private readonly webhook: BillingWebhookService,
  ) {}

  /**
   * Endpoint consumido pelo Stripe. Público (sem JWT): a autenticidade vem da
   * assinatura do webhook, verificada com `STRIPE_WEBHOOK_SECRET` sobre o
   * `rawBody` (Buffer). Sem contexto de owner — o service usa o client admin.
   */
  @Public()
  @Post('webhook')
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature: string,
  ) {
    let event: Stripe.Event;
    try {
      event = this.stripe.client.webhooks.constructEvent(
        req.rawBody!,
        signature,
        this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
      );
    } catch {
      throw new BadRequestException('Assinatura do webhook inválida.');
    }
    await this.webhook.process(event);
    return { received: true };
  }
}
