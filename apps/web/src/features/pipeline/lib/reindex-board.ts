import type { Deal } from '../api/types';

/**
 * Move `dealId` para (toStageId, toPosition) reindexando as `position` das colunas
 * afetadas. Retorna um NOVO array (imutável) para o cache do React Query.
 */
export function reindexBoard(
  deals: Deal[],
  dealId: string,
  toStageId: string,
  toPosition: number,
): Deal[] {
  const moving = deals.find((d) => d.id === dealId);
  if (!moving) return deals;
  const fromStageId = moving.stageId;

  const target = deals
    .filter((d) => d.stageId === toStageId && d.id !== dealId)
    .sort((a, b) => a.position - b.position);
  const clamped = Math.max(0, Math.min(toPosition, target.length));
  const orderedTarget = [
    ...target.slice(0, clamped),
    { ...moving, stageId: toStageId },
    ...target.slice(clamped),
  ];

  const positions = new Map<string, { stageId: string; position: number }>();
  orderedTarget.forEach((d, i) => positions.set(d.id, { stageId: toStageId, position: i }));

  if (fromStageId !== toStageId) {
    deals
      .filter((d) => d.stageId === fromStageId && d.id !== dealId)
      .sort((a, b) => a.position - b.position)
      .forEach((d, i) => positions.set(d.id, { stageId: fromStageId, position: i }));
  }

  return deals.map((d) => {
    const p = positions.get(d.id);
    return p ? { ...d, stageId: p.stageId, position: p.position } : d;
  });
}
