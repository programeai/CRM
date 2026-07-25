import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

/**
 * Wrapper do SDK do Stripe. Só instancia o client quando o billing está
 * habilitado (`BILLING_ENABLED=true`) **e** a chave secreta está presente —
 * na autohospedagem (billing off) o Stripe nunca é inicializado.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);
  private readonly stripe: Stripe | null;
  readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const key = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const billingEnabled = this.config.get<boolean>('BILLING_ENABLED') ?? false;
    this.enabled = billingEnabled && key.length > 0;
    this.stripe = this.enabled ? new Stripe(key) : null;
    if (billingEnabled && !this.enabled) {
      this.logger.warn({
        evento: 'billing.configuracao_incompleta',
        msg: 'BILLING_ENABLED=true mas STRIPE_SECRET_KEY ausente — billing inativo.',
      });
    }
  }

  get client(): Stripe {
    if (!this.stripe) {
      throw new Error('Stripe não configurado nesta instância.');
    }
    return this.stripe;
  }
}
