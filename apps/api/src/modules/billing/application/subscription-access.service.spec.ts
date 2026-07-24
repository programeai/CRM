import { SubscriptionAccessService } from './subscription-access.service';
import type {
  SubscriptionRepository,
  SubscriptionSnapshot,
} from '../domain/subscription.repository';

const future = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe('SubscriptionAccessService', () => {
  let repo: jest.Mocked<SubscriptionRepository>;
  let service: SubscriptionAccessService;

  beforeEach(() => {
    repo = {
      findByOwnerId: jest.fn(),
      findByOwnerIdForGate: jest.fn(),
      getUserStripeCustomerId: jest.fn(),
      setUserStripeCustomerId: jest.fn(),
      upsertByStripeCustomerId: jest.fn(),
    };
    service = new SubscriptionAccessService(repo);
  });

  const snap = (over: Partial<SubscriptionSnapshot>): SubscriptionSnapshot => ({
    status: 'TRIALING',
    trialEndsAt: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    ...over,
  });

  it('sem assinatura → sem acesso', () => {
    expect(service.isActive(null)).toBe(false);
  });

  it('TRIALING com trial no futuro → acesso', () => {
    expect(
      service.isActive(snap({ status: 'TRIALING', trialEndsAt: future() })),
    ).toBe(true);
  });

  it('TRIALING com trial expirado → sem acesso', () => {
    expect(
      service.isActive(snap({ status: 'TRIALING', trialEndsAt: past() })),
    ).toBe(false);
  });

  it('TRIALING sem data de trial → sem acesso', () => {
    expect(
      service.isActive(snap({ status: 'TRIALING', trialEndsAt: null })),
    ).toBe(false);
  });

  it('ACTIVE sem currentPeriodEnd → confia no status (acesso)', () => {
    expect(
      service.isActive(snap({ status: 'ACTIVE', currentPeriodEnd: null })),
    ).toBe(true);
  });

  it('ACTIVE com período no futuro → acesso; expirado → sem acesso', () => {
    expect(
      service.isActive(snap({ status: 'ACTIVE', currentPeriodEnd: future() })),
    ).toBe(true);
    expect(
      service.isActive(snap({ status: 'ACTIVE', currentPeriodEnd: past() })),
    ).toBe(false);
  });

  it('PAST_DUE em grace (período futuro) → acesso; expirado → sem acesso', () => {
    expect(
      service.isActive(
        snap({ status: 'PAST_DUE', currentPeriodEnd: future() }),
      ),
    ).toBe(true);
    expect(
      service.isActive(snap({ status: 'PAST_DUE', currentPeriodEnd: past() })),
    ).toBe(false);
    expect(
      service.isActive(snap({ status: 'PAST_DUE', currentPeriodEnd: null })),
    ).toBe(false);
  });

  it('CANCELED e INCOMPLETE → sem acesso', () => {
    expect(service.isActive(snap({ status: 'CANCELED' }))).toBe(false);
    expect(service.isActive(snap({ status: 'INCOMPLETE' }))).toBe(false);
  });

  it('hasAccess lê pelo caminho do gate (admin)', async () => {
    repo.findByOwnerIdForGate.mockResolvedValue(
      snap({ status: 'ACTIVE', currentPeriodEnd: future() }),
    );
    await expect(service.hasAccess('owner')).resolves.toBe(true);
    expect(repo.findByOwnerIdForGate).toHaveBeenCalledWith('owner');
    expect(repo.findByOwnerId).not.toHaveBeenCalled();
  });
});
