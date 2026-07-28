import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { captacaoApi } from './captacao.api';
import type { CanalBody } from './types';

export function useCanaisDeCaptacao() {
  return useQuery({
    queryKey: queryKeys.canaisDeCaptacao.all,
    queryFn: () => captacaoApi.listCanais(),
  });
}

export function useCreateCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CanalBody) => captacaoApi.createCanal(body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.canaisDeCaptacao.all }),
  });
}

export function useUpdateCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CanalBody> }) =>
      captacaoApi.updateCanal(id, body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.canaisDeCaptacao.all }),
  });
}

export function useDeleteCanal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => captacaoApi.deleteCanal(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.canaisDeCaptacao.all }),
  });
}

/**
 * Rotacionar invalida a lista de **canais**, e não uma lista de chaves: a chave
 * é exibida dentro da linha do canal, e é o `mascarada`/`ultimoUsoEm` dela que
 * precisa ser relido.
 */
export function useRotacionarChave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => captacaoApi.rotacionarChave(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.canaisDeCaptacao.all }),
  });
}
