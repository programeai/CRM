import { StripeService } from './stripe.service';
import type { ConfigService } from '@nestjs/config';

/** ConfigService falso a partir de um mapa de variáveis. */
function config(vars: Record<string, unknown>): ConfigService {
  return { get: (key: string) => vars[key] } as unknown as ConfigService;
}

describe('StripeService', () => {
  it('desabilitado quando BILLING_ENABLED=false (mesmo com chave)', () => {
    const svc = new StripeService(
      config({ BILLING_ENABLED: false, STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(svc.enabled).toBe(false);
    expect(() => svc.client).toThrow('Stripe não configurado nesta instância.');
  });

  it('desabilitado quando a chave está ausente (mesmo com billing on)', () => {
    const svc = new StripeService(
      config({ BILLING_ENABLED: true, STRIPE_SECRET_KEY: '' }),
    );
    expect(svc.enabled).toBe(false);
    expect(() => svc.client).toThrow();
  });

  it('habilitado quando billing on + chave presente; expõe o client', () => {
    const svc = new StripeService(
      config({ BILLING_ENABLED: true, STRIPE_SECRET_KEY: 'sk_test_x' }),
    );
    expect(svc.enabled).toBe(true);
    expect(svc.client).toBeDefined();
  });
});
