import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { catalogosApi } from './catalogos.api';
import type { CatalogKind, CreateCatalogItemBody } from './types';

/**
 * Invalidação: excluir um item mexe no rótulo **embutido** em todo registro que
 * o usa, então a mutação precisa derrubar também as listas de negócio daquele
 * catálogo. Sem isso a tela de clientes continuaria exibindo o item numa
 * listagem de onde ele já saiu, até um refetch por outro motivo.
 */
const DEPENDENTES: Record<CatalogKind, readonly unknown[][]> = {
  servicos: [['deals', 'board'], ['proposals'], ['projects']],
  'fontes-de-lead': [['clients']],
  'tipos-de-atividade': [['activities'], ['dashboard']],
  'motivos-de-perda': [['deals', 'board']],
};

export function useCatalogo(kind: CatalogKind) {
  return useQuery({
    queryKey: queryKeys.catalogos.list(kind),
    queryFn: () => catalogosApi.list(kind),
  });
}

function invalidateCatalogo(qc: ReturnType<typeof useQueryClient>, kind: CatalogKind) {
  void qc.invalidateQueries({ queryKey: ['catalogos', kind] });
  for (const key of DEPENDENTES[kind]) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

export function useCreateCatalogItem(kind: CatalogKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCatalogItemBody) => catalogosApi.create(kind, body),
    onSuccess: () => invalidateCatalogo(qc, kind),
  });
}

export function useDeleteCatalogItem(kind: CatalogKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => catalogosApi.remove(kind, id),
    onSuccess: () => invalidateCatalogo(qc, kind),
  });
}
