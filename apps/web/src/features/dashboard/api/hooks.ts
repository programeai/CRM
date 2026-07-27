import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { dashboardApi } from './dashboard.api';

/** `onlyMine` entra na query key: os dois recortes convivem no cache. */
export function useDashboardSummary(params: { onlyMine?: boolean } = {}) {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(params),
    queryFn: () => dashboardApi.summary(params),
  });
}

/**
 * `enabled` desliga a busca para quem não tem permissão de financeiro — a rota
 * responde 403 e não há por que pedir (ver `DashboardPage`).
 */
export function useDashboardFinance(month?: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.dashboard.finance(month),
    queryFn: () => dashboardApi.finance(month),
    enabled,
  });
}
