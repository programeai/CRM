import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { translateTaskStatus } from '@/lib/labels';
import type { Task, TaskStatus } from '../api/types';

interface Props {
  status: TaskStatus;
  tasks: Task[];
  children: ReactNode; // cards
}

export function KanbanColumn({ status, tasks, children }: Props) {
  const { setNodeRef } = useDroppable({ id: status, data: { status } });
  return (
    <div
      ref={setNodeRef}
      className="flex h-full w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium">{translateTaskStatus(status)}</span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
      </SortableContext>
    </div>
  );
}
