import { api } from '@/lib/api';
import type { DashboardFinance, DashboardSummary } from './types';

export const dashboardApi = {
  summary: (params: { onlyMine?: boolean } = {}) =>
    api
      .get<DashboardSummary>('/dashboard/summary', {
        params: params.onlyMine ? { onlyMine: true } : undefined,
      })
      .then((r) => r.data),
  finance: (month?: string) =>
    api
      .get<DashboardFinance>('/dashboard/finance', {
        params: month ? { month } : undefined,
      })
      .then((r) => r.data),
};
