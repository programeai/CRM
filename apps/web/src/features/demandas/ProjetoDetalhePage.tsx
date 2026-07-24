import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { ArrowLeft, FolderX, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
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
import { useBoard, useDeleteProject, useMoveTask, useProject } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { SortableTaskCard } from './components/SortableTaskCard';
import { TaskCard } from './components/TaskCard';
import { ProjectFormDialog } from './ProjectFormDialog';
import { TaskFormDialog } from './TaskFormDialog';
import { extractApiMessage } from './lib/api-error';
import { PROJECT_STATUS_BADGE, TASK_STATUS_ORDER } from './lib/project-format';
import type { Task, TaskStatus } from './api/types';

export default function ProjetoDetalhePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const goBack = useGoBack('/projetos');
  const { data: project, isLoading: loadingProject, isError } = useProject(id);
  const { data: tasks, isLoading: loadingTasks } = useBoard(id);
  const moveTask = useMoveTask(id);
  const deleteProject = useDeleteProject();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [activeTask, setActiveTask] = useState<Task | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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

  const openCreateTask = () => {
    setEditingTask(undefined);
    setTaskFormOpen(true);
  };
  const openEditTask = (task: Task) => {
    setEditingTask(task);
    setTaskFormOpen(true);
  };

  /** Resolve o status destino e a posição a partir do `over`. */
  function resolveTarget(overId: string, activeId: string) {
    const status = TASK_STATUS_ORDER.find((s) => s === overId);
    if (status) {
      // soltou sobre a própria coluna (área vazia) → fim da coluna
      const col = byStatus.get(status) ?? [];
      const withoutActive = col.filter((t) => t.id !== activeId);
      return { status, position: withoutActive.length };
    }
    // soltou sobre um card → assume o status e o índice desse card
    const overTask = (tasks ?? []).find((t) => t.id === overId);
    if (!overTask) return null;
    const col = (byStatus.get(overTask.status) ?? []).filter((t) => t.id !== activeId);
    const index = col.findIndex((t) => t.id === overId);
    return { status: overTask.status, position: index < 0 ? col.length : index };
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveTask((tasks ?? []).find((t) => t.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = e;
    if (!over) return;
    const target = resolveTarget(String(over.id), String(active.id));
    if (!target) return;
    const current = (tasks ?? []).find((t) => t.id === active.id);
    if (current && current.status === target.status && current.position === target.position) return;

    moveTask.mutate({ id: String(active.id), body: target });
  }

  const confirmDelete = async () => {
    try {
      await deleteProject.mutateAsync(id);
      toast.success('Projeto excluído.');
      navigate('/projetos');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao excluir o projeto.'));
    } finally {
      setDeleteOpen(false);
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
            <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
              <Trash2 data-icon="inline-start" />
              Excluir
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto">
            {TASK_STATUS_ORDER.map((status) => {
              const statusTasks = byStatus.get(status) ?? [];
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
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Excluir projeto"
        description={`Tem certeza que deseja excluir o projeto "${project.name}"? Esta ação não pode ser desfeita.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        pending={deleteProject.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
