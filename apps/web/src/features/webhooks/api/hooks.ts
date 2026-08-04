import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { webhooksApi } from './webhooks.api';
import type { AtualizarWebhookBody, CriarWebhookBody } from './types';

/** Catálogo de eventos — o front consome os rótulos daqui, nunca os duplica. */
export function useEventosDeWebhook() {
  return useQuery({
    queryKey: queryKeys.webhooks.eventos,
    queryFn: () => webhooksApi.listEventos(),
  });
}

export function useWebhooks() {
  return useQuery({
    queryKey: queryKeys.webhooks.all,
    queryFn: () => webhooksApi.list(),
  });
}

function invalidar(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.webhooks.all });
}

export function useCriarWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CriarWebhookBody) => webhooksApi.criar(body),
    onSuccess: () => invalidar(qc),
  });
}

export function useAtualizarWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: AtualizarWebhookBody }) =>
      webhooksApi.atualizar(id, body),
    onSuccess: () => invalidar(qc),
  });
}

export function useVerificarWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.verificar(id),
    onSuccess: () => invalidar(qc),
  });
}

/**
 * Rotacionar invalida a lista porque nada visível muda — mas o `updatedAt` sim,
 * e a tela mostra o segredo novo num diálogo próprio, uma única vez.
 */
export function useRotacionarSegredoDoWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.rotacionar(id),
    onSuccess: () => invalidar(qc),
  });
}

export function useExcluirWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => webhooksApi.excluir(id),
    onSuccess: () => invalidar(qc),
  });
}
