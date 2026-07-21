import { useMemo, useState } from 'react';
import { Plus, Settings2 } from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, closestCorners,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from '@dnd-kit/core';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard, useMoveDeal, useStages } from './api/hooks';
import { KanbanColumn } from './components/KanbanColumn';
import { SortableDealCard } from './components/SortableDealCard';
import { DealCard } from './components/DealCard';
import { DealFormDialog } from './DealFormDialog';
import { LostReasonDialog } from './LostReasonDialog';
import { StageConfigDialog } from './StageConfigDialog';
import type { Deal } from './api/types';

export default function PipelineBoardPage() {
  const { data: stages, isLoading: loadingStages } = useStages();
  const { data: deals, isLoading: loadingDeals } = useBoard();
  const [formOpen, setFormOpen] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);
  const [editing, setEditing] = useState<Deal | undefined>();
  const [activeDeal, setActiveDeal] = useState<Deal | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stageId: string; position: number } | null>(
    null,
  );
  const moveDeal = useMoveDeal();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

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

  const openCreate = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (deal: Deal) => {
    setEditing(deal);
    setFormOpen(true);
  };

  /** Resolve o estágio destino e a posição a partir do `over`. */
  function resolveTarget(overId: string, activeId: string) {
    const stage = (stages ?? []).find((s) => s.id === overId);
    if (stage) {
      // soltou sobre a própria coluna (área vazia) → fim da coluna
      const col = byStage.get(stage.id) ?? [];
      const withoutActive = col.filter((d) => d.id !== activeId);
      return { stageId: stage.id, position: withoutActive.length };
    }
    // soltou sobre um card → assume o estágio e o índice desse card
    const overDeal = (deals ?? []).find((d) => d.id === overId);
    if (!overDeal) return null;
    const col = (byStage.get(overDeal.stageId) ?? []).filter((d) => d.id !== activeId);
    const index = col.findIndex((d) => d.id === overId);
    return { stageId: overDeal.stageId, position: index < 0 ? col.length : index };
  }

  function handleDragStart(e: DragStartEvent) {
    setActiveDeal((deals ?? []).find((d) => d.id === e.active.id) ?? null);
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveDeal(null);
    const { active, over } = e;
    if (!over) return;
    const target = resolveTarget(String(over.id), String(active.id));
    if (!target) return;
    const current = (deals ?? []).find((d) => d.id === active.id);
    if (current && current.stageId === target.stageId && current.position === target.position) return;

    const targetStage = (stages ?? []).find((s) => s.id === target.stageId);
    if (targetStage?.isLost) {
      setPendingLost({ id: String(active.id), ...target }); // abre diálogo antes de persistir
      return;
    }
    moveDeal.mutate({ id: String(active.id), body: target });
  }

  const isLoading = loadingStages || loadingDeals;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold">Pipeline</h1>
        <div className="flex items-center gap-2">
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
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div className="flex min-h-0 min-w-0 flex-1 gap-4 overflow-x-auto">
            {(stages ?? []).map((stage) => {
              const stageDeals = byStage.get(stage.id) ?? [];
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
