import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { translateServiceType } from '@/lib/labels';
import { formatDealAmount, isCooling } from '../lib/deal-format';
import type { Deal } from '../api/types';

interface Props {
  deal: Deal;
  cooling?: boolean; // calculado pelo pai (só estágios não terminais)
  onClick?: () => void;
}

export function DealCard({ deal, cooling, onClick }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border bg-card p-3 text-left shadow-sm hover:border-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium">{deal.title}</span>
        {cooling && isCooling(deal.stageMovedAt) && (
          <Badge variant="destructive" className="gap-1">
            <Flame className="size-3" /> Esfriando
          </Badge>
        )}
      </div>
      <span className="text-xs text-muted-foreground">{deal.client.name}</span>
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{translateServiceType(deal.serviceType)}</Badge>
        <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
      </div>
    </button>
  );
}
