export const SUBSCRIPTION_REPOSITORY = Symbol('SUBSCRIPTION_REPOSITORY');

export type SubscriptionStatusValue =
  'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'INCOMPLETE';

/** Estado local da assinatura, espelho do Stripe (usado pelo gate de acesso). */
export interface SubscriptionSnapshot {
  status: SubscriptionStatusValue;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Campos gravados pelo webhook a partir dos eventos do Stripe. */
export type SubscriptionUpsert = Partial<SubscriptionSnapshot> & {
  stripeSubscriptionId?: string | null;
};

export interface SubscriptionRepository {
  /** Assinatura do owner atual (caminho HTTP, sob RLS via prisma.db). */
  findByOwnerId(ownerId: string): Promise<SubscriptionSnapshot | null>;
  /**
   * Assinatura de um owner para o gate de acesso. O BillingGuard roda **antes**
   * do OwnerContextInterceptor (guards precedem interceptors no NestJS), então
   * ainda não há contexto de RLS — lê via client admin, filtrando pelo `ownerId`
   * já autenticado (do JWT).
   */
  findByOwnerIdForGate(ownerId: string): Promise<SubscriptionSnapshot | null>;
  /** Id de cliente Stripe do owner atual (User está fora do RLS). */
  getUserStripeCustomerId(ownerId: string): Promise<string | null>;
  /** Persiste o id de cliente Stripe no User do owner atual. */
  setUserStripeCustomerId(
    ownerId: string,
    stripeCustomerId: string,
  ): Promise<void>;
  /**
   * Upsert da assinatura resolvendo o owner pelo `stripeCustomerId` do evento.
   * Usado pelo webhook (sem contexto de owner) — via client admin (bypassa RLS).
   */
  upsertByStripeCustomerId(
    stripeCustomerId: string,
    data: SubscriptionUpsert,
  ): Promise<void>;
}
