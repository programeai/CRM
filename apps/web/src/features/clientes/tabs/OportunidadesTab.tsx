import { useState } from 'react';
import { useOutletContext } from 'react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle,
} from '@/components/ui/empty';
import { KanbanSquare } from 'lucide-react';
import { stringFilter, useUrlFilters } from '@/hooks/use-url-filters';
import { useDealsByClient, useStages } from '@/features/pipeline/api/hooks';
import { DealFormDialog } from '@/features/pipeline/DealFormDialog';
import { DealDetailSheet } from '@/features/pipeline/DealDetailSheet';
import { formatDealAmount } from '@/features/pipeline/lib/deal-format';
import type { Client } from '../api/types';

/** `''` = nenhuma aberta. Ver o mesmo param em `PipelineBoardPage`. */
const OPORTUNIDADES_FILTERS = { oportunidade: stringFilter() };

export default function OportunidadesTab() {
  const client = useOutletContext<Client>();
  const { data, isLoading } = useDealsByClient(client.id);
  const { data: stages } = useStages();
  const [formOpen, setFormOpen] = useState(false);
  // Drawer na URL, não em estado local — mesma razão do quadro: de dentro dele se
  // navega para a proposta, e o "voltar" tem de reabrir o mesmo negócio.
  const { values, set } = useUrlFilters(OPORTUNIDADES_FILTERS);

  const stageName = (id: string) => stages?.find((s) => s.id === id)?.name ?? '—';
  const deals = data?.data ?? [];
  const detailDeal = deals.find((d) => d.id === values.oportunidade);

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
            <li key={deal.id}>
              {/* Mesma superfície do quadro: a oportunidade abre no detalhe, onde
                  se registra atividade e se agenda follow-up sem sair do cliente. */}
              <button
                type="button"
                onClick={() => set({ oportunidade: deal.id })}
                className="flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left hover:border-ring"
              >
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">{deal.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {stageName(deal.stageId)} · {deal.serviceType.name}
                    {deal.lostReason && <> · {deal.lostReason.name}</>}
                  </span>
                </div>
                <span className="text-sm tabular-nums">{formatDealAmount(deal.amount)}</span>
              </button>
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

      <DealDetailSheet
        deal={detailDeal}
        open={!!detailDeal}
        onOpenChange={(o) => !o && set({ oportunidade: '' })}
      />

      <DealFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        defaultClientId={client.id}
      />
    </div>
  );
}
