import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';
import { extractApiMessage } from './lib/api-error';
import {
  useCreateStage,
  useDeleteStage,
  useReorderStages,
  useStages,
  useUpdateStage,
} from './api/hooks';
import type { PipelineStage } from './api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Uma linha arrastável, com estado local do nome (edição inline, salva no blur). */
function SortableStageRow({
  stage,
  onDelete,
}: {
  stage: PipelineStage;
  onDelete: () => void;
}) {
  const update = useUpdateStage();
  const [name, setName] = useState(stage.name);
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: stage.id });

  useEffect(() => setName(stage.name), [stage.name]);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === stage.name) {
      setName(stage.name);
      return;
    }
    update.mutate(
      { id: stage.id, body: { name: trimmed } },
      {
        onError: (error) => {
          toast.error(extractApiMessage(error, 'Falha ao renomear o estágio.'));
          setName(stage.name);
        },
      },
    );
  };

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-card p-3',
        isDragging && 'z-10 opacity-70 shadow-md',
      )}
    >
      <button
        type="button"
        className="text-muted-foreground touch-none"
        aria-label="Reordenar estágio"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-4" />
      </button>

      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        placeholder="Nome do estágio"
        className="max-w-56"
      />

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={stage.isWon}
          onCheckedChange={(checked) =>
            update.mutate({ id: stage.id, body: { isWon: checked } })
          }
        />
        Ganhou
      </label>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={stage.isLost}
          onCheckedChange={(checked) =>
            update.mutate({ id: stage.id, body: { isLost: checked } })
          }
        />
        Perdeu
      </label>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="size-4" />
      </Button>
    </li>
  );
}

export function StageConfigDialog({ open, onOpenChange }: Props) {
  const { data: stages } = useStages();
  const reorder = useReorderStages();
  const create = useCreateStage();
  const remove = useDeleteStage();

  const [newName, setNewName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = [...(stages ?? [])].sort((a, b) => a.order - b.order);
  const ids = ordered.map((s) => s.id);

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    reorder.mutate(next);
  };

  const addStage = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed });
      setNewName('');
      toast.success('Estágio criado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao criar o estágio.'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await remove.mutateAsync(deleteId);
      toast.success('Estágio excluído.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao excluir o estágio.'));
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Configurar estágios</DialogTitle>
            <DialogDescription>
              Arraste para reordenar, renomeie, marque estágios de ganho/perda ou exclua
              estágios sem oportunidades.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={ids} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2">
                  {ordered.map((stage) => (
                    <SortableStageRow
                      key={stage.id}
                      stage={stage}
                      onDelete={() => setDeleteId(stage.id)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            <Field className="mt-4">
              <FieldLabel htmlFor="new-stage">Novo estágio</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="new-stage"
                  placeholder="Nome do estágio"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void addStage();
                    }
                  }}
                />
                <Button type="button" onClick={() => void addStage()}>
                  <Plus data-icon="inline-start" />
                  Adicionar
                </Button>
              </div>
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title="Excluir estágio"
        description="Tem certeza que deseja excluir este estágio? Estágios com oportunidades não podem ser excluídos."
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </>
  );
}
