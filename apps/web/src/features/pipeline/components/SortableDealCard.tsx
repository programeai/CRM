import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DealCard } from './DealCard';
import type { Deal } from '../api/types';

interface Props {
  deal: Deal;
  cooling: boolean;
  onClick: () => void;
}

export function SortableDealCard({ deal, cooling, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: deal.id,
    data: { stageId: deal.stageId },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      {...attributes}
      {...listeners}
    >
      <DealCard deal={deal} cooling={cooling} onClick={onClick} />
    </div>
  );
}
