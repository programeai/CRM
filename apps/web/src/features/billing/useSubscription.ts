import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { getBillingStatus } from './api';

/** Um dia em milissegundos. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Carrega o status da assinatura e deriva os campos usados pela UI.
 * O backend é a autoridade do gate (o `402` é o bloqueio real); aqui só
 * espelhamos para exibir banners/telas.
 */
export function useSubscription() {
  const query = useQuery({
    queryKey: queryKeys.billing.status,
    queryFn: getBillingStatus,
  });

  const data = query.data;
  const billingEnabled = data?.billingEnabled ?? false;
  const trialEndsAt = data?.trialEndsAt ? new Date(data.trialEndsAt) : null;

  const daysLeftInTrial =
    data?.status === 'TRIALING' && trialEndsAt
      ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS))
      : null;

  return {
    ...query,
    status: data?.status ?? null,
    billingEnabled,
    trialEndsAt,
    daysLeftInTrial,
    isTrialing: data?.status === 'TRIALING',
    // Só bloqueia quando o billing está ligado e o backend nega acesso.
    isBlocked: billingEnabled && data?.hasAccess === false,
    hasAccess: data?.hasAccess ?? true,
  };
}
