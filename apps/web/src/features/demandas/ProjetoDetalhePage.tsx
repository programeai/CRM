import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Archive, ArrowLeft, FolderX, Pencil, Plus } from 'lucide-react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { useKanbanDnd } from '@/hooks/use-kanban-dnd';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TableLink } from '@/components/ui/table-link';
import { useGoBack } from '@/hooks/use-go-back';
import { translateProjectStatus, translateServiceType } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { useArchiveProject, useBoard, useMoveTask, useProject } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { SortableTaskCard } from './components/SortableTaskCard';
import { TaskCard } from './components/TaskCard';
import { ProjectFormDialog } from './ProjectFormDialog';
import { TaskFormDialog } from './TaskFormDialog';
import { extractApiMessage } from './lib/api-error';
import { PROJECT_STATUS_BADGE, TASK_STATUS_ORDER } from './lib/project-format';
import type { Task, TaskStatus } from './api/types';

const getTaskId = (t: Task) => t.id;

export default function ProjetoDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack('/projetos');
  const { data: project, isLoading: loadingProject, isError } = useProject(id);
  const { data: tasks, isLoading: loadingTasks } = useBoard(id);
  const moveTask = useMoveTask(id);
  const archiveProject = useArchiveProject();

  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();

  const byStatus = useMemo(() => {
    const map = new Map<TaskStatus, Task[]>();
    for (const t of tasks ?? []) {
      const arr = map.get(t.status) ?? [];
      arr.push(t);
      map.set(t.status, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [tasks]);

  const columns = useMemo(
    () => TASK_STATUS_ORDER.map((status) => ({ id: status, items: byStatus.get(status) ?? [] })),
    [byStatus],
  );

  const { activeId, getColumnItems, dndContextProps } = useKanbanDnd<Task>({
    columns,
    getId: getTaskId,
    onDrop: ({ id, toColumnId, toIndex }) => {
      const status = toColumnId as TaskStatus;
      const current = (tasks ?? []).find((t) => t.id === id);
      if (current && current.status === status && current.position === toIndex) return false;
      moveTask.mutate({ id, body: { status, position: toIndex } });
      return true;
    },
  });

  const activeTask = activeId ? (tasks ?? []).find((t) => t.id === activeId) ?? null : null;

  const openCreateTask = () => {
    setEditingTask(undefined);
    setTaskFormOpen(true);
  };
  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskFormOpen(true);
  };

  const confirmArchive = async () => {
    try {
      await archiveProject.mutateAsync(id);
      toast.success('Projeto arquivado.');
      navigate('/projetos');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao arquivar o projeto.'));
    } finally {
      setArchiveOpen(false);
    }
  };

  if (loadingProject) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (isError || !project) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FolderX />
          </EmptyMedia>
          <EmptyTitle>Projeto não encontrado.</EmptyTitle>
          <EmptyDescription>
            <Button variant="link" onClick={goBack}>
              Voltar para projetos
            </Button>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0 text-muted-foreground"
          onClick={goBack}
        >
          <ArrowLeft data-icon="inline-start" />
          Voltar
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-3">
              <h1 className="font-heading text-2xl font-semibold">{project.name}</h1>
              <Badge variant={PROJECT_STATUS_BADGE[project.status]}>
                {translateProjectStatus(project.status)}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">
              <TableLink to={`/clientes/${project.client.id}`}>{project.client.name}</TableLink>
              {' · '}
              {translateServiceType(project.serviceType)}
              {project.dueDate && ` · Prazo: ${formatDate(project.dueDate)}`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil data-icon="inline-start" />
              Editar
            </Button>
            <Button variant="destructive" onClick={() => setArchiveOpen(true)}>
              <Archive data-icon="inline-start" />
              Arquivar
            </Button>
            <Button onClick={openCreateTask}>
              <Plus data-icon="inline-start" />
              Nova tarefa
            </Button>
          </div>
        </div>
      </div>

      {loadingTasks ? (
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
                      onClick={() => openEditTask(task)}
                    />
                  ))}
                </KanbanColumn>
              );
            })}
          </div>
          <DragOverlay>{activeTask && <TaskCard task={activeTask} />}</DragOverlay>
        </DndContext>
      )}

      <ProjectFormDialog open={editOpen} onOpenChange={setEditOpen} project={project} />

      <TaskFormDialog
        open={taskFormOpen}
        onOpenChange={setTaskFormOpen}
        task={editingTask}
        defaultProjectId={id}
      />

      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title="Arquivar projeto"
        description={`Tem certeza que deseja arquivar o projeto "${project.name}"? Ele sai da listagem e vai para a lixeira, de onde pode ser restaurado. As demandas dele continuam ativas.`}
        confirmLabel="Arquivar"
        pendingLabel="Arquivando…"
        destructive
        pending={archiveProject.isPending}
        onConfirm={() => void confirmArchive()}
      />
    </div>
  );
}
