import { api } from '@/lib/api';

export type SubscriptionStatus =
  | 'TRIALING'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'CANCELED'
  | 'INCOMPLETE';

export type BillingStatus = {
  /** Com false, o front esconde toda a UI de billing (autohospedagem). */
  billingEnabled: boolean;
  status: SubscriptionStatus | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Autoridade do gate no backend; com billing off é sempre true. */
  hasAccess: boolean;
};

/** Status da assinatura do owner atual. */
export function getBillingStatus() {
  return api.get<BillingStatus>('/billing/status').then((r) => r.data);
}

/** Abre o Checkout do Stripe e redireciona o navegador para a URL hospedada. */
export async function startCheckout(): Promise<void> {
  const { data } = await api.post<{ url: string }>('/billing/checkout');
  window.location.href = data.url;
}

/** Abre o Customer Portal do Stripe e redireciona o navegador. */
export async function openPortal(): Promise<void> {
  const { data } = await api.post<{ url: string }>('/billing/portal');
  window.location.href = data.url;
}
