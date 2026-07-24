import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StripeService } from './stripe.service';
import { SubscriptionAccessService } from './subscription-access.service';
import { UsersService } from '../../users/users.service';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
  type SubscriptionStatusValue,
} from '../domain/subscription.repository';

/** Resposta do `GET /billing/status` — snapshot + flags para o frontend. */
export interface BillingStatus {
  /** Reflete `StripeService.enabled`: com false, o front esconde toda a UI de billing. */
  billingEnabled: boolean;
  status: SubscriptionStatusValue | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** Autoridade do gate: com billing off é sempre true. */
  hasAccess: boolean;
}

@Injectable()
export class BillingService {
  constructor(
    private readonly stripe: StripeService,
    private readonly access: SubscriptionAccessService,
    private readonly users: UsersService,
    private readonly config: ConfigService,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly repo: SubscriptionRepository,
  ) {}

  /**
   * Cria (ou reaproveita) o customer no Stripe e abre uma sessão de Checkout
   * no modo assinatura para o preço único configurado. Retorna a URL hospedada.
   */
  async createCheckoutSession(ownerId: string): Promise<{ url: string }> {
    this.assertEnabled();
    const customerId = await this.ensureCustomer(ownerId);
    const base = this.frontendBase();
    const priceId = this.config.getOrThrow<string>('STRIPE_PRICE_ID');

    const session = await this.stripe.client.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/assinatura?checkout=sucesso`,
      cancel_url: `${base}/assinatura?checkout=cancelado`,
    });

    if (!session.url) {
      throw new ServiceUnavailableException(
        'Não foi possível iniciar o pagamento. Tente novamente.',
      );
    }
    return { url: session.url };
  }

  /** Abre o Customer Portal do Stripe para o owner gerenciar a assinatura. */
  async createPortalSession(ownerId: string): Promise<{ url: string }> {
    this.assertEnabled();
    const customerId = await this.repo.getUserStripeCustomerId(ownerId);
    if (!customerId) {
      throw new NotFoundException('Assinatura não encontrada.');
    }
    const session = await this.stripe.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${this.frontendBase()}/assinatura`,
    });
    return { url: session.url };
  }

  /** Status da assinatura do owner atual (para o frontend). */
  async getStatus(ownerId: string): Promise<BillingStatus> {
    const enabled = this.stripe.enabled;
    const sub = await this.repo.findByOwnerId(ownerId);
    return {
      billingEnabled: enabled,
      status: sub?.status ?? null,
      trialEndsAt: sub?.trialEndsAt ?? null,
      currentPeriodEnd: sub?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: sub?.cancelAtPeriodEnd ?? false,
      // Billing off → acesso livre (autohospedagem). Ligado → regra do gate.
      hasAccess: enabled ? this.access.isActive(sub) : true,
    };
  }

  /** Garante um `stripeCustomerId` no User, criando o customer no Stripe se faltar. */
  private async ensureCustomer(ownerId: string): Promise<string> {
    const existing = await this.repo.getUserStripeCustomerId(ownerId);
    if (existing) return existing;

    const user = await this.users.findById(ownerId);
    if (!user) throw new NotFoundException('Usuário não encontrado.');

    const customer = await this.stripe.client.customers.create({
      email: user.email,
      name: user.name,
      metadata: { ownerId },
    });
    await this.repo.setUserStripeCustomerId(ownerId, customer.id);
    return customer.id;
  }

  private assertEnabled(): void {
    if (!this.stripe.enabled) {
      throw new ServiceUnavailableException(
        'Cobrança não está habilitada nesta instância.',
      );
    }
  }

  private frontendBase(): string {
    return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/$/, '');
  }
}
