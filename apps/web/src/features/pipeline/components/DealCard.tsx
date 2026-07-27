import { Flame } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
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
      <span className="text-xs text-muted-foreground">
        {deal.client.name}
        {deal.assignee && <> · {deal.assignee.name}</>}
      </span>
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{deal.serviceType.name}</Badge>
        <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
      </div>
      {/* Primeiro caminho de leitura do motivo de perda: até a Fase 13-A ele era
          write-only (nenhum componente o renderizava). */}
      {deal.lostReason && (
        <Badge variant="destructive" className="self-start">
          {deal.lostReason.name}
        </Badge>
      )}
    </button>
  );
}
