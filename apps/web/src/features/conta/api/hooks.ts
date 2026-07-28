import { useMutation, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { contaApi } from './conta.api';

/**
 * As duas mutações do encerramento invalidam `queryKeys.auth.me`: é de lá que
 * o banner global (`AppLayout`) e a seção da aba "Conta" leem o estado do
 * agendamento — nenhuma tem estado próprio.
 */
export function useSolicitarEncerramento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { password?: string; email?: string }) =>
      contaApi.solicitarEncerramento(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}

export function useCancelarEncerramento() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => contaApi.cancelarEncerramento(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.auth.me });
    },
  });
}
