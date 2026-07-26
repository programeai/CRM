import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { dashboardApi } from './dashboard.api';

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: () => dashboardApi.summary(),
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
