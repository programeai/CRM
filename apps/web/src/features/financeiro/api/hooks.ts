import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { contractsApi } from './contracts.api';
import { paymentsApi } from './payments.api';
import type {
  CreateContractBody,
  ListContractsParams,
  ListPaymentsParams,
  PaymentSummaryParams,
  PayPaymentBody,
  UpdateContractBody,
  UpdatePaymentBody,
} from './types';

// --- Contracts ---
export function useContracts(params: ListContractsParams) {
  return useQuery({
    queryKey: queryKeys.contracts.list(params),
    queryFn: () => contractsApi.list(params),
  });
}
export function useContractsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.contracts.byClient(clientId),
    queryFn: () => contractsApi.listByClient(clientId),
    enabled: !!clientId,
  });
}
export function useContract(id: string) {
  return useQuery({
    queryKey: queryKeys.contracts.detail(id),
    queryFn: () => contractsApi.get(id),
    enabled: !!id,
  });
}
/** Baixar/estornar uma cobrança muda o saldo do contrato: invalida as duas raízes. */
function invalidateFinance(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.contracts.all });
  void qc.invalidateQueries({ queryKey: queryKeys.payments.all });
}

export function useCreateContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateContractBody) => contractsApi.create(body),
    onSuccess: () => invalidateFinance(qc),
  });
}
export function useUpdateContract(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateContractBody) => contractsApi.update(id, body),
    onSuccess: () => invalidateFinance(qc),
  });
}
/** Ações de status do contrato: pause/resume/cancel (cancelar também afeta cobranças). */
export function useContractAction(action: 'pause' | 'resume' | 'cancel') {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => contractsApi[action](id),
    onSuccess: () => invalidateFinance(qc),
  });
}

// --- Payments ---
export function usePayments(params: ListPaymentsParams) {
  return useQuery({
    queryKey: queryKeys.payments.list(params),
    queryFn: () => paymentsApi.list(params),
  });
}
export function usePaymentsSummary(params: PaymentSummaryParams) {
  return useQuery({
    queryKey: queryKeys.payments.summary(params),
    queryFn: () => paymentsApi.summary(params),
  });
}
export function useUpdatePayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdatePaymentBody) => paymentsApi.update(id, body),
    onSuccess: () => invalidateFinance(qc),
  });
}
export function usePayPayment(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PayPaymentBody) => paymentsApi.pay(id, body),
    onSuccess: () => invalidateFinance(qc),
  });
}
export function useRevertPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsApi.revert(id),
    onSuccess: () => invalidateFinance(qc),
  });
}
export function useCancelPayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsApi.cancel(id),
    onSuccess: () => invalidateFinance(qc),
  });
}
