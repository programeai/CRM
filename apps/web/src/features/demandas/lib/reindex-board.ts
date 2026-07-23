import type { Task, TaskStatus } from '../api/types';

/**
 * Move `taskId` para (toStatus, toPosition) reindexando as `position` das colunas
 * afetadas. Retorna um NOVO array (imutável) para o cache do React Query.
 */
export function reindexBoard(
  tasks: Task[],
  taskId: string,
  toStatus: TaskStatus,
  toPosition: number,
): Task[] {
  const moving = tasks.find((t) => t.id === taskId);
  if (!moving) return tasks;
  const fromStatus = moving.status;

  const target = tasks
    .filter((t) => t.status === toStatus && t.id !== taskId)
    .sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(toPosition, target.length));
  const orderedTarget = [
    ...target.slice(0, clamped),
    { ...moving, status: toStatus },
    ...target.slice(clamped),
  ];

  const positions = new Map<string, { status: TaskStatus; position: number }>();
  orderedTarget.forEach((t, i) => positions.set(t.id, { status: toStatus, position: i }));

  if (fromStatus !== toStatus) {
    tasks
      .filter((t) => t.status === fromStatus && t.id !== taskId)
      .sort((a, b) => a.position - b.position)
      .forEach((t, i) => positions.set(t.id, { status: fromStatus, position: i }));
  }

  return tasks.map((t) => {
    const p = positions.get(t.id);
    return p ? { ...t, status: p.status, position: p.position } : t;
  });
}
