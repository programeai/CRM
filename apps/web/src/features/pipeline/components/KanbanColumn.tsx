import type { ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { formatDealAmount } from '../lib/deal-format';
import type { Deal, PipelineStage } from '../api/types';

interface Props {
  stage: PipelineStage;
  deals: Deal[];
  children: ReactNode; // cards
}

export function KanbanColumn({ stage, deals, children }: Props) {
  const { setNodeRef } = useDroppable({ id: stage.id, data: { stageId: stage.id } });
  const sum = deals.reduce((acc, d) => acc + (d.amount ? Number(d.amount) : 0), 0);
  return (
    <div
      ref={setNodeRef}
      className="flex h-full w-72 shrink-0 flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="truncate text-sm font-medium">{stage.name}</span>
        <span className="text-xs text-muted-foreground">{deals.length}</span>
      </div>
      <span className="text-xs text-muted-foreground">
        {formatDealAmount(String(sum))}
      </span>
      <SortableContext items={deals.map((d) => d.id)} strategy={verticalListSortingStrategy}>
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">{children}</div>
      </SortableContext>
    </div>
  );
}
