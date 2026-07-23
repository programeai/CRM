import { api } from '@/lib/api';
import type {
  ListPaymentsParams,
  Paginated,
  Payment,
  PaymentSummary,
  PaymentSummaryParams,
  PayPaymentBody,
  UpdatePaymentBody,
} from './types';

export const paymentsApi = {
  list: (params: ListPaymentsParams) =>
    api.get<Paginated<Payment>>('/payments', { params }).then((r) => r.data),
  summary: (params: PaymentSummaryParams) =>
    api.get<PaymentSummary>('/payments/summary', { params }).then((r) => r.data),
  update: (id: string, body: UpdatePaymentBody) =>
    api.patch<Payment>(`/payments/${id}`, body).then((r) => r.data),
  pay: (id: string, body: PayPaymentBody) =>
    api.post<Payment>(`/payments/${id}/pay`, body).then((r) => r.data),
  revert: (id: string) => api.post<Payment>(`/payments/${id}/revert`).then((r) => r.data),
  cancel: (id: string) => api.post<Payment>(`/payments/${id}/cancel`).then((r) => r.data),
};
