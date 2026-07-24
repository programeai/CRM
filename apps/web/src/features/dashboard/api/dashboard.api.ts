import { api } from '@/lib/api';
import type { DashboardFinance, DashboardSummary } from './types';

export const dashboardApi = {
  summary: () =>
    api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
  finance: (month?: string) =>
    api
      .get<DashboardFinance>('/dashboard/finance', {
        params: month ? { month } : undefined,
      })
      .then((r) => r.data),
};
