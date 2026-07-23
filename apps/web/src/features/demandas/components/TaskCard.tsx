import { CalendarClock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { translateTaskPriority } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { isOverdue } from '../lib/overdue';
import { TASK_PRIORITY_BADGE } from '../lib/project-format';
import type { Task } from '../api/types';

interface Props {
  task: Task;
  onClick?: () => void;
}

export function TaskCard({ task, onClick }: Props) {
  const overdue = isOverdue(task);
  const checklistTotal = task.checklist?.length ?? 0;
  const checklistDone = task.checklist?.filter((i) => i.done).length ?? 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-sm hover:border-ring ${
        overdue ? 'border-destructive' : ''
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{task.title}</span>
        <Badge variant={TASK_PRIORITY_BADGE[task.priority]}>
          {translateTaskPriority(task.priority)}
        </Badge>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${overdue ? 'text-destructive' : ''}`}>
            <CalendarClock className="size-3" />
            {formatDate(task.dueDate)}
          </span>
        )}
        {overdue && <Badge variant="destructive">Atrasada</Badge>}
        {checklistTotal > 0 && (
          <span>
            {checklistDone}/{checklistTotal}
          </span>
        )}
      </div>
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <Badge key={tag} variant="secondary">
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </button>
  );
}
