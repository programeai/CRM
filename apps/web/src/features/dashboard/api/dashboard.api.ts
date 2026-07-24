import { api } from '@/lib/api';
import type { DashboardFinance, DashboardSummary } from './types';

export const dashboardApi = {
  summary: () =>
    api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
  finance: () =>
    api.get<DashboardFinance>('/dashboard/finance').then((r) => r.data),
};
