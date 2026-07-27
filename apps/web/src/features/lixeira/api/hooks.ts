import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
// Exceção consciente ao isolamento entre features (apps/web/CLAUDE.md): a
// lixeira é um read model que atravessa cinco recursos, e restaurar/expurgar
// são rotas DO RECURSO, não da lixeira — a alternativa seria duplicar cinco
// clientes HTTP aqui dentro. Mover os `*.api.ts` para `lib/` seria a solução
// "pura", mas é uma refatoração maior, fora desta fase.
import { clientsApi } from '@/features/clientes/api/clients.api';
import { dealsApi } from '@/features/pipeline/api/deals.api';
import { projectsApi } from '@/features/demandas/api/projects.api';
import { tasksApi } from '@/features/demandas/api/tasks.api';
import { trashApi } from './trash.api';
import type { ListTrashParams, TrashType } from './types';

export function useTrash(params: ListTrashParams) {
  return useQuery({
    queryKey: queryKeys.trash.list(params),
    queryFn: () => trashApi.list(params),
  });
}

/** Rota por tipo: restaurar e expurgar pertencem ao módulo dono do registro. */
const API_POR_TIPO: Record<
  TrashType,
  { restore: (id: string) => Promise<unknown>; purge: (id: string) => Promise<unknown> }
> = {
  CLIENT: { restore: clientsApi.restore, purge: clientsApi.remove },
  CONTACT: { restore: clientsApi.restoreContact, purge: clientsApi.purgeContact },
  DEAL: { restore: dealsApi.restore, purge: dealsApi.remove },
  PROJECT: { restore: projectsApi.restore, purge: projectsApi.remove },
  TASK: { restore: tasksApi.restore, purge: tasksApi.remove },
};

/** Raiz do domínio afetado por tipo — invalidada junto da lixeira para o
 * registro reaparecer (restaurar) ou sumir de vez (expurgar) na tela de origem. */
const ROOT_QUERY_KEY: Record<TrashType, readonly unknown[]> = {
  CLIENT: queryKeys.clients.all,
  CONTACT: queryKeys.clients.all, // contatos vivem sob `['clients', clientId, 'contacts']`
  DEAL: queryKeys.deals.all,
  PROJECT: queryKeys.projects.all,
  TASK: queryKeys.tasks.all,
};

function invalidateAfterMutation(
  qc: ReturnType<typeof useQueryClient>,
  type: TrashType,
) {
  void qc.invalidateQueries({ queryKey: queryKeys.trash.all });
  void qc.invalidateQueries({ queryKey: ROOT_QUERY_KEY[type] });
}

export function useRestoreItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: TrashType; id: string }) =>
      API_POR_TIPO[type].restore(id),
    onSuccess: (_data, { type }) => invalidateAfterMutation(qc, type),
  });
}

export function usePurgeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, id }: { type: TrashType; id: string }) =>
      API_POR_TIPO[type].purge(id),
    onSuccess: (_data, { type }) => invalidateAfterMutation(qc, type),
  });
}
