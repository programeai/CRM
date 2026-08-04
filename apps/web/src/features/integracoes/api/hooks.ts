import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { captacaoApi } from './captacao.api';
import { integracoesApi } from './integracoes.api';
import type { CanalBody, CreateChaveBody } from './types';

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
 * Rotacionar invalida a lista de **canais** e a de **chaves de API**: o mesmo
 * endpoint serve os dois consumidores (a chave é exibida dentro da linha do
 * canal na aba Captação, e como linha própria na aba API), e é o
 * `mascarada`/`ultimoUsoEm` dela que precisa ser relido em qualquer um dos dois.
 */
export function useRotacionarChave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => captacaoApi.rotacionarChave(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.canaisDeCaptacao.all });
      qc.invalidateQueries({ queryKey: queryKeys.integracoes.chaves });
    },
  });
}

/** Catálogo de escopos — o front consome os rótulos daqui, nunca os duplica. */
export function useEscopos() {
  return useQuery({
    queryKey: queryKeys.integracoes.escopos,
    queryFn: () => integracoesApi.listEscopos(),
  });
}

/**
 * As chaves de API do owner. A rota devolve TODAS as chaves, inclusive as dos
 * canais de captação — que são exibidas dentro da linha do canal, na aba
 * Captação. O recorte é pelo escopo, e não por um filtro no backend, porque
 * `GET /integracoes/chaves` é legitimamente "todas as chaves" e a distinção é
 * da TELA: quem olha esta aba quer as chaves que ele mesmo emitiu.
 */
export function useChavesDeApi() {
  return useQuery({
    queryKey: queryKeys.integracoes.chaves,
    queryFn: async () => {
      const chaves = await integracoesApi.listChaves();
      return chaves.filter((c) => !c.escopos.includes('lead:receber'));
    },
  });
}

export function useCriarChave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChaveBody) => integracoesApi.criarChave(body),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.integracoes.chaves }),
  });
}

export function useRevogarChave() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => integracoesApi.revogarChave(id),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: queryKeys.integracoes.chaves }),
  });
}
