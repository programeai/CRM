import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import { dealsApi } from './deals.api';
import { stagesApi } from './stages.api';
import { reindexBoard } from '../lib/reindex-board';
import type {
  CreateDealBody,
  CreateStageBody,
  Deal,
  MoveDealBody,
  PipelineStage,
  UpdateDealBody,
  UpdateStageBody,
} from './types';

// --- Board / stages ---
export function useBoard() {
  return useQuery({ queryKey: queryKeys.deals.board, queryFn: dealsApi.board });
}
export function useStages() {
  return useQuery({ queryKey: queryKeys.stages.all, queryFn: stagesApi.list });
}
export function useDealsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.deals.byClient(clientId),
    queryFn: () => dealsApi.listByClient(clientId),
  });
}
// --- Deal mutations ---
function invalidateDeals(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.deals.all });
}
export function useCreateDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDealBody) => dealsApi.create(body),
    onSuccess: () => invalidateDeals(qc),
  });
}
export function useUpdateDeal(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDealBody) => dealsApi.update(id, body),
    onSuccess: () => invalidateDeals(qc),
  });
}
export function useDeleteDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dealsApi.remove(id),
    onSuccess: () => invalidateDeals(qc),
  });
}

/** Move com optimistic update no cache do board; reverte em erro e reconcilia no settle. */
export function useMoveDeal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveDealBody }) => dealsApi.move(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.board });
      const prev = qc.getQueryData<Deal[]>(queryKeys.deals.board);
      if (prev) {
        qc.setQueryData<Deal[]>(
          queryKeys.deals.board,
          reindexBoard(prev, id, body.stageId, body.position),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.deals.board, ctx.prev);
      toast.error('Falha ao mover a oportunidade.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.deals.board });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all });
    },
  });
}

// --- Stage mutations ---
function invalidateStages(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.stages.all });
  void qc.invalidateQueries({ queryKey: queryKeys.deals.board });
}
export function useCreateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateStageBody) => stagesApi.create(body),
    onSuccess: () => invalidateStages(qc),
  });
}
export function useUpdateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateStageBody }) =>
      stagesApi.update(id, body),
    onSuccess: () => invalidateStages(qc),
  });
}
export function useReorderStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => stagesApi.reorder(ids),
    onMutate: async (ids) => {
      await qc.cancelQueries({ queryKey: queryKeys.stages.all });
      const prev = qc.getQueryData<PipelineStage[]>(queryKeys.stages.all);
      if (prev) {
        const byId = new Map(prev.map((s) => [s.id, s]));
        const next = ids
          .map((id, order) => {
            const stage = byId.get(id);
            return stage ? { ...stage, order } : undefined;
          })
          .filter((s): s is PipelineStage => s !== undefined);
        qc.setQueryData<PipelineStage[]>(queryKeys.stages.all, next);
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.stages.all, ctx.prev);
      toast.error('Falha ao reordenar os estágios.');
    },
    onSettled: () => invalidateStages(qc),
  });
}
export function useDeleteStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stagesApi.remove(id),
    onSuccess: () => invalidateStages(qc),
  });
}
