import type { Task } from '../api/types';

/** Atrasada: tem prazo passado e não está concluída. Derivado no client (sem estado no backend). */
export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>): boolean {
  if (!task.dueDate || task.status === 'DONE') return false;
  const due = new Date(task.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}
