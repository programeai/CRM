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

/**
 * O que a sincronização do webhook mudou. `null` quando o evento não mapeia
 * para nenhum owner (cliente Stripe desconhecido).
 *
 * Existe para a trilha de auditoria: o webhook roda sem ator e sem contexto de
 * owner, e é o repositório que resolve o `ownerId` pelo `stripeCustomerId`. O
 * `antes` permite ao `BillingWebhookService` registrar **só quando algo mudou**
 * — o Stripe reenvia eventos, e N linhas idênticas por retentativa são ruído.
 */
export interface SubscriptionSyncResult {
  ownerId: string;
  antes: SubscriptionSnapshot | null;
  depois: SubscriptionSnapshot;
}

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
  /** Id da assinatura no Stripe, sob RLS (caminho HTTP). `null` sem assinatura. */
  getStripeSubscriptionId(ownerId: string): Promise<string | null>;
  /** O mesmo, pelo client admin — para o cron, que roda sem `app.owner_id`. */
  getStripeSubscriptionIdForSystem(ownerId: string): Promise<string | null>;
  /**
   * Upsert da assinatura resolvendo o owner pelo `stripeCustomerId` do evento.
   * Usado pelo webhook (sem contexto de owner) — via client admin (bypassa RLS).
   *
   * Devolve o antes/depois para a trilha, ou `null` se o cliente Stripe não
   * mapeia para nenhum owner (evento ignorado, comportamento inalterado).
   */
  upsertByStripeCustomerId(
    stripeCustomerId: string,
    data: SubscriptionUpsert,
  ): Promise<SubscriptionSyncResult | null>;
}
