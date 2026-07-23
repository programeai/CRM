import type { ProjectStatus, TaskPriority, TaskStatus } from '../api/types';

export const PROJECT_STATUS_BADGE: Record<
  ProjectStatus, 'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  PAUSED: 'outline',
  DONE: 'secondary',
  CANCELED: 'destructive',
};

export const TASK_PRIORITY_BADGE: Record<
  TaskPriority, 'default' | 'secondary' | 'outline' | 'destructive'
> = {
  LOW: 'secondary',
  MEDIUM: 'outline',
  HIGH: 'default',
  URGENT: 'destructive',
};

// Ordem das colunas do Kanban (segue a ordem do enum no schema).
export const TASK_STATUS_ORDER: TaskStatus[] = [
  'BACKLOG', 'TODO', 'IN_PROGRESS', 'REVIEW', 'DONE',
];
