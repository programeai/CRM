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

  /**
   * Marca a assinatura para NÃO renovar, preservando o acesso até o fim do ciclo
   * pago. É o que o encerramento agendado precisa: ninguém é cobrado por um ciclo
   * que não vai usar, e o `BillingGuard` continua liberando durante a carência.
   *
   * Idempotente: chamar de novo numa assinatura já marcada é no-op no Stripe.
   */
  async agendarCancelamento(stripeSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.update(stripeSubscriptionId, {
      cancel_at_period_end: true,
    });
  }

  /**
   * Cancela agora. Chamado no expurgo, quando a conta deixa de existir — sem
   * isto o objeto remoto continuaria cobrando um cliente que já foi apagado, e o
   * webhook viraria órfão (o `stripeCustomerId` some com o `User`).
   *
   * Assinatura já cancelada devolve `resource_missing`/estado final: tratado como
   * sucesso por quem chama, porque o efeito desejado já vale.
   */
  async cancelarAgora(stripeSubscriptionId: string): Promise<void> {
    await this.client.subscriptions.cancel(stripeSubscriptionId);
  }
}
