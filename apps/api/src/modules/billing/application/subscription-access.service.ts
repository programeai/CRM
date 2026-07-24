import { Inject, Injectable } from '@nestjs/common';
import {
  SUBSCRIPTION_REPOSITORY,
  type SubscriptionRepository,
  type SubscriptionSnapshot,
} from '../domain/subscription.repository';

/**
 * Fonte única de verdade do gate de acesso (consumida pelo BillingGuard).
 * Regras:
 *  - TRIALING: acesso enquanto `trialEndsAt > agora`.
 *  - ACTIVE: acesso enquanto `currentPeriodEnd > agora` (ou sem data → confia no status).
 *  - PAST_DUE: grace até `currentPeriodEnd`; depois bloqueia.
 *  - CANCELED / INCOMPLETE / sem assinatura: sem acesso.
 */
@Injectable()
export class SubscriptionAccessService {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly repo: SubscriptionRepository,
  ) {}

  async hasAccess(ownerId: string): Promise<boolean> {
    // Consumido pelo BillingGuard (pré-contexto de RLS) → leitura via admin.
    const sub = await this.repo.findByOwnerIdForGate(ownerId);
    return this.isActive(sub);
  }

  /** Avalia um snapshot já carregado (evita re-consulta em quem já tem o dado). */
  isActive(sub: SubscriptionSnapshot | null): boolean {
    if (!sub) return false;
    const now = new Date();
    switch (sub.status) {
      case 'TRIALING':
        return sub.trialEndsAt ? sub.trialEndsAt > now : false;
      case 'ACTIVE':
        return sub.currentPeriodEnd ? sub.currentPeriodEnd > now : true;
      case 'PAST_DUE':
        return sub.currentPeriodEnd ? sub.currentPeriodEnd > now : false;
      case 'CANCELED':
      case 'INCOMPLETE':
      default:
        return false;
    }
  }
}
