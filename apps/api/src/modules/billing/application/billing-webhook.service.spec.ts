import { BillingWebhookService } from './billing-webhook.service';
import type { StripeService } from './stripe.service';
import type { SubscriptionRepository } from '../domain/subscription.repository';

/** Monta um objeto mínimo de Stripe.Subscription para os testes. */
function subscription(over: Record<string, unknown> = {}) {
  return {
    id: 'sub_123',
    customer: 'cus_123',
    status: 'active',
    trial_end: null,
    cancel_at_period_end: false,
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...over,
  };
}

describe('BillingWebhookService', () => {
  let repo: jest.Mocked<SubscriptionRepository>;
  let stripe: { client: { subscriptions: { retrieve: jest.Mock } } };
  let service: BillingWebhookService;

  beforeEach(() => {
    repo = {
      findByOwnerId: jest.fn(),
      findByOwnerIdForGate: jest.fn(),
      getUserStripeCustomerId: jest.fn(),
      setUserStripeCustomerId: jest.fn(),
      upsertByStripeCustomerId: jest.fn(),
    };
    stripe = { client: { subscriptions: { retrieve: jest.fn() } } };
    service = new BillingWebhookService(
      stripe as unknown as StripeService,
      repo,
    );
  });

  const process = (type: string, object: unknown) =>
    service.process({ type, data: { object } } as never);

  it('mapeia status do Stripe → local em customer.subscription.updated', async () => {
    const cases: Array<[string, string]> = [
      ['trialing', 'TRIALING'],
      ['active', 'ACTIVE'],
      ['past_due', 'PAST_DUE'],
      ['unpaid', 'PAST_DUE'],
      ['incomplete', 'INCOMPLETE'],
      ['canceled', 'CANCELED'],
      ['incomplete_expired', 'CANCELED'],
      ['paused', 'CANCELED'],
    ];
    for (const [stripeStatus, local] of cases) {
      repo.upsertByStripeCustomerId.mockClear();
      await process(
        'customer.subscription.updated',
        subscription({ status: stripeStatus }),
      );
      expect(repo.upsertByStripeCustomerId).toHaveBeenCalledWith(
        'cus_123',
        expect.objectContaining({ status: local }),
      );
    }
  });

  it('extrai currentPeriodEnd dos itens da assinatura', async () => {
    await process('customer.subscription.updated', subscription());
    expect(repo.upsertByStripeCustomerId).toHaveBeenCalledWith(
      'cus_123',
      expect.objectContaining({
        stripeSubscriptionId: 'sub_123',
        currentPeriodEnd: new Date(1_800_000_000 * 1000),
      }),
    );
  });

  it('customer.subscription.deleted → status CANCELED', async () => {
    await process(
      'customer.subscription.deleted',
      subscription({ status: 'active' }),
    );
    expect(repo.upsertByStripeCustomerId).toHaveBeenCalledWith(
      'cus_123',
      expect.objectContaining({ status: 'CANCELED' }),
    );
  });

  it('checkout.session.completed busca a assinatura e sincroniza', async () => {
    stripe.client.subscriptions.retrieve.mockResolvedValue(
      subscription({ status: 'active' }),
    );
    await process('checkout.session.completed', { subscription: 'sub_123' });
    expect(stripe.client.subscriptions.retrieve).toHaveBeenCalledWith(
      'sub_123',
    );
    expect(repo.upsertByStripeCustomerId).toHaveBeenCalledWith(
      'cus_123',
      expect.objectContaining({ status: 'ACTIVE' }),
    );
  });

  it('evento não tratado → nenhum upsert', async () => {
    await process('invoice.paid', {});
    expect(repo.upsertByStripeCustomerId).not.toHaveBeenCalled();
  });
});
