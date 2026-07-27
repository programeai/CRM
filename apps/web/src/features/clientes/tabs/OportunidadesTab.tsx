import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { KanbanSquare } from 'lucide-react';
import { useDealsByClient, useStages } from '@/features/pipeline/api/hooks';
import { DealFormDialog } from '@/features/pipeline/DealFormDialog';
import { formatDealAmount } from '@/features/pipeline/lib/deal-format';
import type { Client } from '../api/types';

export default function OportunidadesTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useDealsByClient(client.id);
  const { data: stages } = useStages();
  const [formOpen, setFormOpen] = useState(false);

  const stageName = (id: string) => stages?.find((s) => s.id === id)?.name ?? '—';
  const deals = data?.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Oportunidades</h2>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus data-icon="inline-start" />
          Nova oportunidade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : deals.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {deals.map((deal) => (
            <li
              key={deal.id}
              className="flex items-center justify-between gap-4 rounded-lg border p-3"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{deal.title}</span>
                <span className="text-xs text-muted-foreground">
                  {stageName(deal.stageId)} · {deal.serviceType.name}
                  {deal.lostReason && <> · {deal.lostReason.name}</>}
                </span>
              </div>
              <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KanbanSquare />
            </EmptyMedia>
            <EmptyTitle>Nenhuma oportunidade</EmptyTitle>
            <EmptyDescription>Crie a primeira oportunidade deste cliente.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultClientId={client.id}
      />
    </div>
  );
}
