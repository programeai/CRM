import { AlignLeft, CalendarClock, CheckSquare, Folder, User } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TagBadge } from '@/components/ui/tag-badge';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { translateTaskPriority } from '@/lib/labels';
import { formatDate } from '@/lib/format';
import { isOverdue } from '../lib/overdue';
import { TASK_PRIORITY_BADGE } from '../lib/project-format';
import type { Task } from '../api/types';

interface Props {
  task: Task;
  onClick?: () => void;
  /** Exibe o projeto da tarefa (usado no board cross-projeto de "Minhas demandas"). */
  showProject?: boolean;
}

export function TaskCard({ task, onClick, showProject = false }: Props) {
  const overdue = isOverdue(task);
  const description = task.description?.trim();
  const checklistTotal = task.checklist?.length ?? 0;
  const checklistDone = task.checklist?.filter((i) => i.done).length ?? 0;
  const checklistComplete = checklistTotal > 0 && checklistDone === checklistTotal;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full flex-col gap-1.5 rounded-lg border bg-card p-3 text-left shadow-sm transition-colors hover:border-ring ${
        overdue ? 'border-destructive/60' : ''
      }`}
    >
      {task.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {task.tags.map((tag) => (
            <TagBadge key={tag} tag={tag} />
          ))}
        </div>
      )}

      <span className="text-sm font-medium leading-snug">{task.title}</span>

      {description && (
        <p className="flex items-start gap-1.5 text-xs leading-snug text-muted-foreground">
          <AlignLeft className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2">{description}</span>
        </p>
      )}

      {showProject && (
        <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
          <Folder className="size-3 shrink-0" />
          <span className="truncate">{task.project.name}</span>
        </span>
      )}

      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        {task.dueDate &&
          (overdue ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex items-center gap-1 rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive" />
                }
              >
                <CalendarClock className="size-3" />
                {formatDate(task.dueDate)}
              </TooltipTrigger>
              <TooltipContent>Tarefa atrasada</TooltipContent>
            </Tooltip>
          ) : (
            <span className="flex items-center gap-1">
              <CalendarClock className="size-3" />
              {formatDate(task.dueDate)}
            </span>
          ))}
        {checklistTotal > 0 && (
          <span
            className={`flex items-center gap-1 ${
              checklistComplete ? 'text-primary' : ''
            }`}
          >
            <CheckSquare className="size-3" />
            {checklistDone}/{checklistTotal}
          </span>
        )}
        {task.assignee && (
          <span className="flex items-center gap-1 truncate">
            <User className="size-3 shrink-0" />
            <span className="truncate">{task.assignee.name}</span>
          </span>
        )}
        <Badge
          variant={TASK_PRIORITY_BADGE[task.priority]}
          className="ml-auto shrink-0 rounded px-1.5 py-0 text-[0.625rem] font-medium leading-4"
        >
          {translateTaskPriority(task.priority)}
        </Badge>
      </div>
    </button>
  );
}
