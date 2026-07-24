import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';

/** Uma coluna do board, com seus itens já agrupados e ordenados. */
export interface KanbanColumnData<T> {
  id: string;
  items: T[];
}

/** Destino resolvido de um card ao soltar. */
export interface KanbanDrop {
  id: string;
  fromColumnId: string;
  toColumnId: string;
  toIndex: number;
}

interface Options<T> {
  /** Colunas ordenadas (inclui as vazias), com itens já ordenados. */
  columns: KanbanColumnData<T>[];
  getId: (item: T) => string;
  /**
   * Persiste o movimento. `toIndex` é o índice de inserção na coluna destino.
   * Retorne `true` se o movimento foi persistido (o override é mantido até os
   * dados do servidor refletirem, evitando o "pulo" ao soltar) ou `false` para
   * um no-op (o override é liberado na hora, voltando à origem).
   */
  onDrop: (drop: KanbanDrop) => boolean;
}

/**
 * Lógica compartilhada de drag-and-drop dos boards Kanban.
 *
 * Mantém um override efêmero do agrupamento **durante o arraste** (`onDragOver`)
 * para que a coluna destino abra espaço em tempo real — dando uma prévia de onde
 * o card vai cair. Ao soltar (`onDragEnd`), calcula o índice final e delega a
 * persistência ao `onDrop`. Fora do arraste, o board é renderizado direto das
 * `columns` (fonte de verdade = React Query).
 */
export function useKanbanDnd<T>({ columns, getId, onDrop }: Options<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Agrupamento (columnId → ids) só populado enquanto há um arraste em curso.
  const [override, setOverride] = useState<Record<string, string[]> | null>(null);
  const fromColumnRef = useRef<string | null>(null);
  // Quando true, o override persistido aguarda a próxima mudança de `columns`
  // (dado do servidor já reconciliado) para ser liberado sem flash.
  const pendingReleaseRef = useRef(false);

  // Sempre lê as colunas mais recentes dentro dos handlers (evita closure obsoleta).
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  // Libera o override assim que os dados do servidor incorporam o movimento
  // (nova referência de `columns` após o update otimista / revert em erro).
  useEffect(() => {
    if (pendingReleaseRef.current) {
      pendingReleaseRef.current = false;
      setOverride(null);
    }
  }, [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const byId = useMemo(() => {
    const map = new Map<string, T>();
    for (const col of columns) for (const it of col.items) map.set(getId(it), it);
    return map;
  }, [columns, getId]);

  /** Snapshot do agrupamento atual (columnId → ids), a partir das colunas vivas. */
  function snapshot(): Record<string, string[]> {
    const snap: Record<string, string[]> = {};
    for (const col of columnsRef.current) snap[col.id] = col.items.map(getId);
    return snap;
  }

  /** Coluna de `id` (a própria, se `id` for uma coluna; senão a que contém o card). */
  function findColumnId(id: string, snap: Record<string, string[]>): string | null {
    if (id in snap) return id;
    for (const [columnId, ids] of Object.entries(snap)) {
      if (ids.includes(id)) return columnId;
    }
    return null;
  }

  /** Itens a renderizar numa coluna — respeita o override durante o arraste. */
  function getColumnItems(columnId: string): T[] {
    const ids = override?.[columnId];
    if (ids) return ids.map((id) => byId.get(id)).filter((it): it is T => it !== undefined);
    return columnsRef.current.find((c) => c.id === columnId)?.items ?? [];
  }

  function handleDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const snap = snapshot();
    pendingReleaseRef.current = false;
    setActiveId(id);
    fromColumnRef.current = findColumnId(id, snap);
    setOverride(snap);
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over } = e;
    if (!over) return;
    const activeCardId = String(active.id);
    const overId = String(over.id);

    setOverride((prev) => {
      const snap = prev ?? snapshot();
      const activeCol = findColumnId(activeCardId, snap);
      const overCol = findColumnId(overId, snap);
      // Só tratamos troca de coluna aqui; reordenação na mesma coluna fica a cargo
      // da estratégia do SortableContext (transform/transition) e do onDragEnd.
      if (!activeCol || !overCol || activeCol === overCol) return prev;

      const activeItems = snap[activeCol];
      const overItems = snap[overCol];
      const overIndex = overItems.indexOf(overId);

      let newIndex: number;
      if (overId in snap) {
        // Sobre a área da coluna (não sobre um card) → fim da coluna.
        newIndex = overItems.length;
      } else {
        const activeRect = active.rect.current.translated;
        const below =
          activeRect && over.rect
            ? activeRect.top > over.rect.top + over.rect.height / 2
            : false;
        newIndex = overIndex + (below ? 1 : 0);
      }

      return {
        ...snap,
        [activeCol]: activeItems.filter((id) => id !== activeCardId),
        [overCol]: [
          ...overItems.slice(0, newIndex),
          activeCardId,
          ...overItems.slice(newIndex),
        ],
      };
    });
  }

  function reset() {
    setActiveId(null);
    setOverride(null);
    fromColumnRef.current = null;
    pendingReleaseRef.current = false;
  }

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    const activeCardId = String(active.id);
    const fromColumnId = fromColumnRef.current;
    if (!over || !fromColumnId) {
      reset();
      return;
    }

    const snap = { ...(override ?? snapshot()) };
    const overId = String(over.id);
    const activeCol = findColumnId(activeCardId, snap);
    const overCol = findColumnId(overId, snap);

    // Reordenação final dentro da coluna destino (após onDragOver já ter migrado
    // o card entre colunas, active e over estão na mesma coluna aqui).
    if (activeCol && overCol && activeCol === overCol) {
      const items = snap[activeCol];
      const activeIndex = items.indexOf(activeCardId);
      const overIndex = overId in snap ? items.length - 1 : items.indexOf(overId);
      if (overIndex >= 0 && activeIndex !== overIndex) {
        snap[activeCol] = arrayMove(items, activeIndex, overIndex);
      }
    }

    const toColumnId = findColumnId(activeCardId, snap);
    const persisted =
      toColumnId !== null &&
      onDrop({
        id: activeCardId,
        fromColumnId,
        toColumnId,
        toIndex: snap[toColumnId].indexOf(activeCardId),
      });

    if (persisted) {
      // Mantém o board na posição final até o dado do servidor reconciliar,
      // para o drop assentar sem pulo. Liberado pelo efeito de `columns`.
      setActiveId(null);
      setOverride(snap);
      fromColumnRef.current = null;
      pendingReleaseRef.current = true;
    } else {
      reset();
    }
  }

  return {
    activeId,
    getColumnItems,
    /** Props para o `<DndContext>` (inclui sensores e detecção de colisão). */
    dndContextProps: {
      sensors,
      collisionDetection: closestCorners,
      onDragStart: handleDragStart,
      onDragOver: handleDragOver,
      onDragEnd: handleDragEnd,
      onDragCancel: reset,
    },
  };
}
