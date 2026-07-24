import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryKeys } from '@/lib/query-keys';
import { projectsApi } from './projects.api';
import { tasksApi } from './tasks.api';
import { reindexBoard } from '../lib/reindex-board';
import type {
  CreateProjectBody, CreateTaskBody, ListProjectsParams, ListTasksParams,
  MoveTaskBody, Task, UpdateProjectBody, UpdateTaskBody,
} from './types';

// --- Projects ---
export function useProjects(params: ListProjectsParams, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: queryKeys.projects.list(params),
    queryFn: () => projectsApi.list(params),
    enabled: options?.enabled ?? true,
  });
}
export function useProjectsByClient(clientId: string) {
  return useQuery({
    queryKey: queryKeys.projects.byClient(clientId),
    queryFn: () => projectsApi.listByClient(clientId),
  });
}
export function useProject(id: string) {
  return useQuery({
    queryKey: queryKeys.projects.detail(id),
    queryFn: () => projectsApi.get(id),
    enabled: !!id,
  });
}
function invalidateProjects(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all });
}
export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateProjectBody) => projectsApi.create(body),
    onSuccess: () => invalidateProjects(qc),
  });
}
export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateProjectBody) => projectsApi.update(id, body),
    onSuccess: () => invalidateProjects(qc),
  });
}
export function useDeleteProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => invalidateProjects(qc),
  });
}

// --- Tasks ---
export function useBoard(projectId: string) {
  return useQuery({
    queryKey: queryKeys.tasks.board(projectId),
    queryFn: () => tasksApi.board(projectId),
    enabled: !!projectId,
  });
}
/** Board cross-projeto de "Minhas demandas" (todas as tarefas do dono). */
export function useMyBoard() {
  return useQuery({
    queryKey: queryKeys.tasks.myBoard,
    queryFn: () => tasksApi.board(),
  });
}
export function useTasks(params: ListTasksParams) {
  return useQuery({
    queryKey: queryKeys.tasks.list(params),
    queryFn: () => tasksApi.list(params),
  });
}
function invalidateTasks(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
  void qc.invalidateQueries({ queryKey: queryKeys.projects.all }); // _count.tasks muda
}
export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTaskBody) => tasksApi.create(body),
    onSuccess: () => invalidateTasks(qc),
  });
}
export function useUpdateTask(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateTaskBody) => tasksApi.update(id, body),
    onSuccess: () => invalidateTasks(qc),
  });
}
export function useDeleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onSuccess: () => invalidateTasks(qc),
  });
}

// --- Tags (agregadas das demandas do dono) ---
/** Tags existentes com contagem de uso, para o autocomplete do seletor. */
export function useTaskTags() {
  return useQuery({
    queryKey: queryKeys.tasks.tags,
    queryFn: () => tasksApi.listTags(),
  });
}
/** Demandas que usam uma tag — carregado sob demanda no modal de exclusão. */
export function useTaskTagUsage(tag: string | null) {
  return useQuery({
    queryKey: queryKeys.tasks.tagUsage(tag ?? ''),
    queryFn: () => tasksApi.tagUsage(tag as string),
    enabled: !!tag,
  });
}
/** Exclui uma tag globalmente (remove de todas as demandas do dono). */
export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) => tasksApi.deleteTag(tag),
    onSuccess: () => invalidateTasks(qc), // invalida ['tasks'] → cobre board e a lista de tags
  });
}

/** Move com optimistic update no board do projeto; reverte em erro e reconcilia no settle. */
export function useMoveTask(projectId: string) {
  const qc = useQueryClient();
  const key = queryKeys.tasks.board(projectId);
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveTaskBody }) => tasksApi.move(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Task[]>(key);
      if (prev) {
        qc.setQueryData<Task[]>(key, reindexBoard(prev, id, body.status, body.position));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error('Falha ao mover a tarefa.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: key });
    },
  });
}

/**
 * Move no board cross-projeto de "Minhas demandas": só muda o status da tarefa
 * (a posição é reindexada por-projeto no backend). Optimistic: atualiza o status
 * no cache; reverte em erro e reconcilia no settle.
 */
export function useMoveMyTask() {
  const qc = useQueryClient();
  const key = queryKeys.tasks.myBoard;
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MoveTaskBody }) => tasksApi.move(id, body),
    onMutate: async ({ id, body }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<Task[]>(key);
      if (prev) {
        qc.setQueryData<Task[]>(
          key,
          prev.map((t) => (t.id === id ? { ...t, status: body.status } : t)),
        );
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
      toast.error('Falha ao mover a tarefa.');
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.tasks.all });
      void qc.invalidateQueries({ queryKey: queryKeys.projects.all }); // _count.tasks não muda, mas board do projeto sim
    },
  });
}
