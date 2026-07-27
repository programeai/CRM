import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Field, FieldLabel } from '@/components/ui/field';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { extractApiMessage } from '@/lib/api-error';
import {
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
  useCatalogo,
} from './api/hooks';
import type { CatalogItem, CatalogKind } from './api/types';

/** Rótulo do item no singular — usado nos placeholders e na mensagem vazia. */
const CATALOG_LABELS: Record<CatalogKind, string> = {
  servicos: 'tipo de serviço',
  'fontes-de-lead': 'fonte de lead',
  'tipos-de-atividade': 'tipo de atividade',
  'motivos-de-perda': 'motivo de perda',
};

interface Props {
  kind: CatalogKind;
}

/** Uma linha do catálogo: rename inline salvo no blur, ativo/inativo, follow-up e exclusão. */
function CatalogItemRow({
  item,
  kind,
  onDelete,
}: {
  item: CatalogItem;
  kind: CatalogKind;
  onDelete: () => void;
}) {
  const update = useUpdateCatalogItem(kind);
  const [name, setName] = useState(item.name);

  useEffect(() => setName(item.name), [item.name]);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === item.name) {
      setName(item.name);
      return;
    }
    update.mutate(
      { id: item.id, body: { name: trimmed } },
      {
        onError: (error) => {
          toast.error(extractApiMessage(error, 'Falha ao renomear o item.'));
          setName(item.name);
        },
      },
    );
  };

  return (
    <li
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3',
        !item.active && 'text-muted-foreground',
      )}
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={saveName}
        placeholder="Nome do item"
        className="max-w-56"
      />

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={item.active}
          onCheckedChange={(checked) =>
            update.mutate({ id: item.id, body: { active: checked } })
          }
        />
        Ativo
      </label>

      {/* Semântica de RÁDIO, não de caixa independente: marcar um item desmarca
          o anterior (o servidor faz isso em `desmarcarOutrosFollowUp`). Por isso
          desmarcar o único marcado é bloqueado aqui — exatamente um tipo tem de
          carregar a regra, senão o cron de lembretes silencia. */}
      {kind === 'tipos-de-atividade' && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={!!item.isFollowUp}
            disabled={!!item.isFollowUp}
            onCheckedChange={(checked) => {
              if (!checked) return;
              update.mutate({ id: item.id, body: { isFollowUp: true } });
            }}
          />
          Usado pelos lembretes de follow-up
        </label>
      )}

      {!item.active && <Badge variant="outline">Desativado</Badge>}

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

export function CatalogTab({ kind }: Props) {
  const { data: itens, isLoading } = useCatalogo(kind, { incluirInativos: true });
  const create = useCreateCatalogItem(kind);
  const remove = useDeleteCatalogItem(kind);

  const [newName, setNewName] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const label = CATALOG_LABELS[kind];
  const ordered = [...(itens ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  const addItem = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    try {
      await create.mutateAsync({ name: trimmed });
      setNewName('');
      toast.success('Item criado.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao criar o item.'));
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await remove.mutateAsync(deleteId);
      toast.success('Item excluído.');
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao excluir o item.'));
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : ordered.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {ordered.map((item) => (
            <CatalogItemRow
              key={item.id}
              item={item}
              kind={kind}
              onDelete={() => setDeleteId(item.id)}
            />
          ))}
        </ul>
      ) : (
        <Empty>
          <EmptyTitle>Nenhum item cadastrado</EmptyTitle>
          <EmptyDescription>
            Cadastre o primeiro {label} abaixo.
          </EmptyDescription>
        </Empty>
      )}

      {kind === 'tipos-de-atividade' && (
        <p className="text-xs text-muted-foreground">
          Exatamente um tipo carrega a marca de follow-up: é por ela que os
          lembretes diários e o bloco "Próximas ações" do painel encontram as
          atividades agendadas. Marcar outro tipo transfere a marca.
        </p>
      )}

      <Field className="max-w-md">
        <FieldLabel htmlFor="new-catalog-item">Novo item</FieldLabel>
        <div className="flex gap-2">
          <Input
            id="new-catalog-item"
            placeholder={`Nome do ${label}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addItem();
              }
            }}
          />
          <Button type="button" onClick={() => void addItem()}>
            <Plus data-icon="inline-start" />
            Adicionar
          </Button>
        </div>
      </Field>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => !o && setDeleteId(null)}
        title={`Excluir ${label}`}
        description={`Tem certeza que deseja excluir este ${label}? Itens em uso não podem ser excluídos — desative-os.`}
        confirmLabel="Excluir"
        pendingLabel="Excluindo…"
        destructive
        pending={remove.isPending}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
