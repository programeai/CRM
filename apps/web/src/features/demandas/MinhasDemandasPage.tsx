import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import { useKanbanDnd } from '@/hooks/use-kanban-dnd';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import {
  enumFilter,
  stringArrayFilter,
  stringFilter,
  useUrlFilters,
} from '@/hooks/use-url-filters';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectItem, SelectTrigger,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { TASK_PRIORITY_LABELS } from '@/lib/labels';
import { useMoveMyTask, useMyBoard } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { SortableTaskCard } from './components/SortableTaskCard';
import { TaskCard } from './components/TaskCard';
import { TaskFormDialog } from './TaskFormDialog';
import { TASK_STATUS_ORDER } from './lib/project-format';
import type { Task, TaskPriority, TaskStatus } from './api/types';

const PRIORITY_RANK: Record<TaskPriority, number> = {
  URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

/** Opções do filtro de prioridade (inclui "todas"). */
const PRIORITY_FILTER_ITEMS: Record<TaskPriority | 'ALL', string> = {
  ALL: 'Todas as prioridades',
  ...TASK_PRIORITY_LABELS,
};

/** Filtros do quadro persistidos na URL (sobrevivem à ida/volta de uma tela de detalhe). */
const DEMANDAS_FILTERS = {
  clientSearch: stringFilter(),
  priority: enumFilter(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[], 'ALL' as const),
  projectIds: stringArrayFilter(),
  dueBefore: stringFilter(),
};

const getTaskId = (t: Task) => t.id;

/** Ordena dentro da coluna: prazo mais próximo primeiro (sem prazo por último), depois prioridade e recência. */
function compareTasks(a: Task, b: Task) {
  const ad = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
  const bd = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
  if (ad !== bd) return ad - bd;
  if (PRIORITY_RANK[a.priority] !== PRIORITY_RANK[b.priority]) {
    return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

export default function MinhasDemandasPage() {
  const { values, set } = useUrlFilters(DEMANDAS_FILTERS);
  const { priority, projectIds, dueBefore } = values;

  // A busca por cliente mantém estado local para digitação responsiva; o valor com
  // debounce é o que é persistido na URL (e usado para filtrar as demandas).
  const [clientSearch, setClientSearch] = useState(values.clientSearch);
  const debouncedClientSearch = useDebouncedValue(clientSearch, 300);
  useEffect(() => {
    if (debouncedClientSearch !== values.clientSearch) {
      set({ clientSearch: debouncedClientSearch });
    }
  }, [debouncedClientSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  const { data: tasks, isLoading } = useMyBoard();
  const moveTask = useMoveMyTask();

  /** Projetos presentes nas demandas carregadas, únicos e ordenados por nome. */
  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of tasks ?? []) {
      if (!map.has(t.project.id)) {
        map.set(t.project.id, `${t.project.client.name} · ${t.project.name}`);
      }
    }
    return Array.from(map, ([value, label]) => ({ value, label })).sort((a, b) =>
      a.label.localeCompare(b.label, 'pt-BR'),
    );
  }, [tasks]);

  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();

  const filtered = useMemo(() => {
    const search = clientSearch.trim().toLowerCase();
    return (tasks ?? []).filter((t) => {
      if (search && !t.project.client.name.toLowerCase().includes(search)) return false;
      if (priority !== 'ALL' && t.priority !== priority) return false;
      if (projectIds.length > 0 && !projectIds.includes(t.project.id)) return false;
      if (dueBefore && (!t.dueDate || t.dueDate.slice(0, 10) > dueBefore)) return false;
      return true;
    });
  }, [tasks, clientSearch, priority, projectIds, dueBefore]);

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const t of filtered) {
      const arr = map.get(t.status) ?? [];
      arr.push(t);
      map.set(t.status, arr);
    }
    for (const arr of map.values()) arr.sort(compareTasks);
    return map;
  }, [filtered]);

  const columns = useMemo(
    () => TASK_STATUS_ORDER.map((status) => ({ id: status, items: byStatus.get(status) ?? [] })),
    [byStatus],
  );

  const { activeId, getColumnItems, dndContextProps } = useKanbanDnd<Task>({
    columns,
    getId: getTaskId,
    onDrop: ({ id, fromColumnId, toColumnId }) => {
      if (fromColumnId === toColumnId) return false; // aqui o arraste só muda de coluna (status)
      const status = toColumnId as TaskStatus;
      const current = (tasks ?? []).find((t) => t.id === id);
      if (!current) return false;
      // posição = fim da coluna de status desse projeto (o backend reindexa por-projeto).
      const position = (tasks ?? []).filter(
        (t) => t.projectId === current.projectId && t.status === status && t.id !== current.id,
      ).length;
      moveTask.mutate({ id, body: { status, position } });
      return true;
    },
  });

  const activeTask = activeId ? (tasks ?? []).find((t) => t.id === activeId) ?? null : null;

  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskFormOpen(true);
  };

  const openCreateTask = () => {
    setEditingTask(undefined);
    setTaskFormOpen(true);
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Minhas demandas</h1>
        <Button onClick={openCreateTask}>
          <Plus data-icon="inline-start" />
          Nova tarefa
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          className="max-w-xs"
          placeholder="Buscar por cliente…"
          value={clientSearch}
          onValueChange={setClientSearch}
        />
        <Select<TaskPriority | 'ALL'>
          items={PRIORITY_FILTER_ITEMS}
          value={priority}
          onValueChange={(v) => set({ priority: v ?? 'ALL' })}
        >
          <SelectTrigger className="ml-auto w-56" />
          <SelectContent>
            {(Object.keys(PRIORITY_FILTER_ITEMS) as (TaskPriority | 'ALL')[]).map((p) => (
              <SelectItem key={p} value={p}>
                {PRIORITY_FILTER_ITEMS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <MultiSelect
          className="w-64"
          options={projectOptions}
          value={projectIds}
          onValueChange={(ids) => set({ projectIds: ids })}
          placeholder="Todos os projetos"
          searchPlaceholder="Buscar projeto…"
          emptyText="Nenhum projeto encontrado."
        />
        <input
          type="date"
          className="h-10 rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          value={dueBefore}
          onChange={(e) => set({ dueBefore: e.target.value })}
        />
      </div>

      {isLoading ? (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-full w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <DndContext {...dndContextProps}>
          <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto">
            {TASK_STATUS_ORDER.map((status) => {
              const statusTasks = getColumnItems(status);
              return (
                <KanbanColumn key={status} status={status} tasks={statusTasks}>
                  {statusTasks.map((task) => (
                    <SortableTaskCard
                      key={task.id}
                      task={task}
                      showProject
                      onClick={() => openEditTask(task)}
                    />
                  ))}
                </KanbanColumn>
              );
            })}
          </div>
          <DragOverlay>{activeTask && <TaskCard task={activeTask} showProject />}</DragOverlay>
        </DndContext>
      )}

      <TaskFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        task={editingTask}
        defaultProjectId={editingTask?.project.id ?? ''}
      />
    </div>
  );
}
