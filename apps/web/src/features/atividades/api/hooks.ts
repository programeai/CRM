import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { activitiesApi } from './activities.api';
import type { ActivityScope, CreateActivityBody } from './types';

export function useActivities(scope: ActivityScope) {
  return useQuery({
    queryKey: queryKeys.activities.byScope(scope),
    queryFn: () => activitiesApi.list(scope),
  });
}

/**
 * Invalida tudo que uma atividade move.
 *
 * O prefixo `activities` cobre os dois recortes de uma vez: uma atividade
 * registrada na oportunidade também aparece na timeline do cliente, e invalidar
 * só o recorte de origem deixaria o outro velho na tela.
 *
 * O quadro do funil entra porque o `nextActivityAt` do card é derivado dessas
 * mesmas atividades — registrar ou concluir um follow-up muda o sinal do card. O
 * dashboard, porque as "próximas ações" saem da mesma consulta.
 */
function invalidateActivities(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.activities.all });
  void qc.invalidateQueries({ queryKey: ['deals', 'board'] });
  void qc.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateActivityBody) => activitiesApi.create(body),
    onSuccess: () => invalidateActivities(qc),
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => activitiesApi.complete(id),
    onSuccess: () => invalidateActivities(qc),
  });
}
