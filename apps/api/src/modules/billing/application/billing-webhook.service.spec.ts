import { BillingWebhookService } from './billing-webhook.service';
import type { StripeService } from './stripe.service';
import type { SubscriptionRepository } from '../domain/subscription.repository';
import type { AuditService } from '../../audit/audit.service';

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
  let audit: { registrarPeloSistema: jest.Mock };
  let service: BillingWebhookService;

  beforeEach(() => {
    repo = {
      findByOwnerId: jest.fn(),
      findByOwnerIdForGate: jest.fn(),
      getUserStripeCustomerId: jest.fn(),
      setUserStripeCustomerId: jest.fn(),
      // Sem owner mapeável por padrão: os testes de mapeamento não precisam de trilha.
      upsertByStripeCustomerId: jest.fn().mockResolvedValue(null),
    };
    stripe = { client: { subscriptions: { retrieve: jest.fn() } } };
    audit = { registrarPeloSistema: jest.fn().mockResolvedValue(undefined) };
    service = new BillingWebhookService(
      stripe as unknown as StripeService,
      repo,
      audit as unknown as AuditService,
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

  it('registra na trilha quando a sincronização muda alguma coisa', async () => {
    repo.upsertByStripeCustomerId.mockResolvedValue({
      ownerId: 'owner-1',
      antes: {
        status: 'TRIALING',
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      depois: {
        status: 'ACTIVE',
        trialEndsAt: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });

    await process('customer.subscription.updated', subscription());

    expect(audit.registrarPeloSistema).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'owner-1',
        actorType: 'WEBHOOK',
        actorName: 'Webhook do Stripe',
        entity: 'SUBSCRIPTION',
        entityId: 'owner-1',
        entityLabel: 'Ativa', // rótulo em pt-BR, nunca o identificador do enum
        action: 'ATUALIZAR',
      }),
    );
  });

  it('reentrega do MESMO evento não cria linha nova (nada mudou)', async () => {
    const igual = {
      status: 'ACTIVE' as const,
      trialEndsAt: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    repo.upsertByStripeCustomerId.mockResolvedValue({
      ownerId: 'owner-1',
      antes: igual,
      depois: igual,
    });

    await process('customer.subscription.updated', subscription());

    expect(audit.registrarPeloSistema).not.toHaveBeenCalled();
  });
});
