import { HttpStatus } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BillingGuard } from './billing.guard';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { ALLOW_WITHOUT_SUBSCRIPTION_KEY } from './allow-without-subscription.decorator';
import type { StripeService } from './application/stripe.service';
import type { SubscriptionAccessService } from './application/subscription-access.service';

/**
 * O gate é de **escrita**. Sem assinatura ativa o owner continua lendo tudo e
 * cadastrando cliente novo; o resto que escreve responde `402`.
 */
describe('BillingGuard', () => {
  let reflector: Reflector;
  let stripe: { enabled: boolean };
  let access: { hasAccess: jest.Mock };
  let guard: BillingGuard;
  /** Metadados por chave, como se viessem dos decorators da rota. */
  let metadata: Record<string, boolean>;

  beforeEach(() => {
    metadata = {};
    reflector = new Reflector();
    jest
      .spyOn(reflector, 'getAllAndOverride')
      .mockImplementation((key: string) => metadata[key] as never);

    stripe = { enabled: true };
    access = { hasAccess: jest.fn().mockResolvedValue(false) };
    guard = new BillingGuard(
      reflector,
      stripe as unknown as StripeService,
      access as unknown as SubscriptionAccessService,
    );
  });

  /** Contexto HTTP mínimo: o guard só lê `method`, `access` e `user`. */
  const ctx = (method: string, ownerId: string | null = 'owner-1') =>
    ({
      getHandler: () => () => undefined,
      getClass: () => class {},
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          access: ownerId ? { ownerId } : undefined,
          user: undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  const esperaBloqueio = async (method: string) => {
    await expect(guard.canActivate(ctx(method))).rejects.toMatchObject({
      status: HttpStatus.PAYMENT_REQUIRED,
    });
  };

  it('billing off (autohospedagem) → libera até escrita', async () => {
    stripe.enabled = false;
    await expect(guard.canActivate(ctx('POST'))).resolves.toBe(true);
    expect(access.hasAccess).not.toHaveBeenCalled();
  });

  it.each(['GET', 'HEAD', 'OPTIONS'])(
    '%s passa sem consultar a assinatura',
    async (method) => {
      await expect(guard.canActivate(ctx(method))).resolves.toBe(true);
      expect(access.hasAccess).not.toHaveBeenCalled();
    },
  );

  it.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    '%s sem acesso → 402',
    async (method) => {
      await esperaBloqueio(method);
    },
  );

  it('escrita com assinatura ativa → passa', async () => {
    access.hasAccess.mockResolvedValue(true);
    await expect(guard.canActivate(ctx('POST'))).resolves.toBe(true);
  });

  it('rota @Public() → libera escrita (ingestão de lead, API pública)', async () => {
    metadata[IS_PUBLIC_KEY] = true;
    await expect(guard.canActivate(ctx('POST'))).resolves.toBe(true);
    expect(access.hasAccess).not.toHaveBeenCalled();
  });

  it('rota @AllowWithoutSubscription() → libera escrita (checkout, criar cliente)', async () => {
    metadata[ALLOW_WITHOUT_SUBSCRIPTION_KEY] = true;
    await expect(guard.canActivate(ctx('POST'))).resolves.toBe(true);
    expect(access.hasAccess).not.toHaveBeenCalled();
  });

  it('usa o ownerId da workspace: colaborador herda o gate do owner', async () => {
    await esperaBloqueio('POST');
    expect(access.hasAccess).toHaveBeenCalledWith('owner-1');
  });

  it('requisição sem owner resolvido → não é papel deste guard barrar', async () => {
    await expect(guard.canActivate(ctx('POST', null))).resolves.toBe(true);
  });
});
