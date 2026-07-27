import { useMemo, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import { DndContext, DragOverlay } from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssigneeFilterSelect } from '@/components/ui/assignee-filter-select';
import { useKanbanDnd } from '@/hooks/use-kanban-dnd';
import { stringFilter, useUrlFilters } from '@/hooks/use-url-filters';
import { useResolvedAssigneeFilter } from '@/lib/members-lookup';
import { useBoard, useMoveDeal, useStages } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { SortableDealCard } from './components/SortableDealCard';
import { DealCard } from './components/DealCard';
import { DealFormDialog } from './DealFormDialog';
import { LostReasonDialog } from './LostReasonDialog';
import { StageConfigDialog } from './StageConfigDialog';
import type { Deal } from './api/types';

const getDealId = (d: Deal) => d.id;

/** Filtro do quadro persistido na URL (sobrevive à ida/volta de uma tela de detalhe). */
const PIPELINE_FILTERS = {
  /** `''` = todos; `'me'` = o usuário logado; senão o id de um membro. */
  assignee: stringFilter(),
};

export default function PipelineBoardPage() {
  const { values, set } = useUrlFilters(PIPELINE_FILTERS);
  const assigneeId = useResolvedAssigneeFilter(values.assignee);
  const boardParams = assigneeId ? { assigneeId } : {};

  const { data: stages, isLoading: loadingStages } = useStages();
  const { data: deals, isLoading: loadingDeals } = useBoard(boardParams);
  const [formOpen, setFormOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>();
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string; position: number } | null>(
    null,
  );
  const moveDeal = useMoveDeal(boardParams);

  const byStage = useMemo(() => {
    const map = new Map<string, Deal[]>();
    for (const d of deals ?? []) {
      const arr = map.get(d.stageId) ?? [];
      arr.push(d);
      map.set(d.stageId, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [deals]);

  const columns = useMemo(
    () => (stages ?? []).map((stage) => ({ id: stage.id, items: byStage.get(stage.id) ?? [] })),
    [stages, byStage],
  );

  const { activeId, getColumnItems, dndContextProps } = useKanbanDnd<Deal>({
    columns,
    getId: getDealId,
    onDrop: ({ id, toColumnId, toIndex }) => {
      const current = (deals ?? []).find((d) => d.id === id);
      if (current && current.stageId === toColumnId && current.position === toIndex) return false;
      const targetStage = (stages ?? []).find((s) => s.id === toColumnId);
      if (targetStage?.isLost) {
        setPendingLost({ id, stageId: toColumnId, position: toIndex }); // confirma motivo antes de persistir
        return false; // volta à origem; o move é aplicado ao confirmar o diálogo
      }
      moveDeal.mutate({ id, body: { stageId: toColumnId, position: toIndex } });
      return true;
    },
  });

  const activeDeal = activeId ? (deals ?? []).find((d) => d.id === activeId) ?? null : null;

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (deal: Deal) => {
    setEditing(deal);
    setFormOpen(true);
  };

  const isLoading = loadingStages || loadingDeals;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Pipeline</h1>
        <div className="flex items-center gap-2">
          <AssigneeFilterSelect
            className="w-56"
            value={values.assignee}
            onValueChange={(assignee) => set({ assignee })}
          />
          <Button variant="outline" onClick={() => setConfigOpen(true)}>
            <Settings2 data-icon="inline-start" />
            Configurar estágios
          </Button>
          <Button onClick={openCreate}>
            <Plus data-icon="inline-start" />
            Nova oportunidade
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-full w-72 shrink-0" />
          ))}
        </div>
      ) : (
        <DndContext {...dndContextProps}>
          <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto">
            {(stages ?? []).map((stage) => {
              const stageDeals = getColumnItems(stage.id);
              const cooling = !stage.isWon && !stage.isLost;
              return (
                <KanbanColumn key={stage.id} stage={stage} deals={stageDeals}>
                  {stageDeals.map((deal) => (
                    <SortableDealCard
                      key={deal.id}
                      deal={deal}
                      cooling={cooling}
                      onClick={() => openEdit(deal)}
                    />
                  ))}
                </KanbanColumn>
              );
            })}
          </div>
          <DragOverlay>{activeDeal && <DealCard deal={activeDeal} />}</DragOverlay>
        </DndContext>
      )}

      <DealFormDialog open={formOpen} onOpenChange={setFormOpen} deal={editing} />

      <LostReasonDialog
        open={!!pendingLost}
        onOpenChange={(o) => !o && setPendingLost(null)}
        onCancel={() => setPendingLost(null)}
        onConfirm={(reason) => {
          if (pendingLost) {
            moveDeal.mutate({
              id: pendingLost.id,
              body: { stageId: pendingLost.stageId, position: pendingLost.position, lostReason: reason },
            });
          }
          setPendingLost(null);
        }}
      />

      <StageConfigDialog open={configOpen} onOpenChange={setConfigOpen} />
    </div>
  );
}
