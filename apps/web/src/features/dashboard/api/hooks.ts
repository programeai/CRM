import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { dashboardApi } from './dashboard.api';

export function useDashboardSummary() {
  return useQuery({
    queryKey: queryKeys.dashboard.summary,
    queryFn: () => dashboardApi.summary(),
  });
}

export function useDashboardFinance(month?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.finance(month),
    queryFn: () => dashboardApi.finance(month),
  });
}
