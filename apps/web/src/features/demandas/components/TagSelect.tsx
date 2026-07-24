import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check, ChevronDown, Plus, Tag, Trash2, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Spinner } from '@/components/ui/spinner';
import { TagBadge } from '@/components/ui/tag-badge';
import { tagColors } from '@/lib/tag-color';
import { cn } from '@/lib/utils';
import { extractApiMessage } from '../lib/api-error';
import { useDeleteTag, useTaskTags, useTaskTagUsage } from '../api/hooks';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

interface Option {
  tag: string;
  /** Em quantas demandas a tag é usada (0 = nova, ainda não salva). */
  count: number;
  /** Se já existe no servidor (autoriza a exclusão global). */
  persisted: boolean;
}

/**
 * Seletor de tags com busca e criação inline. As tags existentes vêm da
 * agregação das demandas do dono (`useTaskTags`); digitar uma que não existe e
 * confirmar com Enter a cadastra na hora (fica salva quando a demanda é salva).
 * Cada tag existente pode ser excluída globalmente pela lixeira, com um modal de
 * confirmação que mostra em quais demandas ela está em uso.
 */
export function TagSelect({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const { data: tags } = useTaskTags();
  const deleteTag = useDeleteTag();

  const options = useMemo<Option[]>(() => {
    const map = new Map<string, Option>();
    for (const t of tags ?? []) {
      map.set(t.tag, { tag: t.tag, count: t.count, persisted: true });
    }
    // Tags selecionadas mas ainda não salvas aparecem na lista (sem lixeira).
    for (const t of value) {
      if (!map.has(t)) map.set(t, { tag: t, count: 0, persisted: false });
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'),
    );
  }, [tags, value]);

  const trimmed = search.trim();
  const query = trimmed.toLowerCase();
  const filtered = query
    ? options.filter((o) => o.tag.toLowerCase().includes(query))
    : options;
  /** Tag já existente (case-insensitive) que corresponde exatamente ao texto digitado. */
  const existing = trimmed
    ? options.find((o) => o.tag.toLowerCase() === query)
    : undefined;
  const canCreate = trimmed.length > 0 && !existing;

  const select = (tag: string) => {
    if (!value.includes(tag)) onChange([...value, tag]);
  };
  const toggle = (tag: string) =>
    onChange(value.includes(tag) ? value.filter((t) => t !== tag) : [...value, tag]);
  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  /** Enter / clique em "Criar": seleciona a existente (na grafia canônica) ou cria a digitada. */
  const commit = () => {
    if (!trimmed) return;
    select(existing ? existing.tag : trimmed);
    setSearch('');
  };

  const openDelete = (tag: string) => {
    setOpen(false);
    setPendingDelete(tag);
  };

  const confirmDelete = () => {
    const tag = pendingDelete;
    if (!tag) return;
    deleteTag.mutate(tag, {
      onSuccess: ({ removed }) => {
        if (value.includes(tag)) remove(tag);
        setPendingDelete(null);
        toast.success(
          removed > 0
            ? `Tag "${tag}" excluída de ${removed} ${removed === 1 ? 'demanda' : 'demandas'}.`
            : `Tag "${tag}" excluída.`,
        );
      },
      onError: (error) =>
        toast.error(extractApiMessage(error, 'Falha ao excluir a tag.')),
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span
              key={tag}
              style={{ ...tagColors(tag), borderColor: 'transparent' }}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[0.6875rem] font-medium leading-4"
            >
              {tag}
              <button
                type="button"
                onClick={() => remove(tag)}
                aria-label={`Remover tag ${tag}`}
                className="-mr-0.5 rounded-sm opacity-80 transition-opacity hover:opacity-100"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm text-muted-foreground transition-colors outline-none select-none',
            'hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          <Tag className="size-4 shrink-0" />
          <span className="flex-1 text-left">Buscar ou criar tag…</span>
          <ChevronDown className="size-4 shrink-0" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
          <div className="p-2">
            <SearchInput
              autoFocus
              value={search}
              onValueChange={setSearch}
              placeholder="Buscar ou criar tag…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commit();
                } else if (e.key === 'Backspace' && !search && value.length > 0) {
                  remove(value[value.length - 1]);
                }
              }}
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1 pt-0">
            {canCreate && (
              <button
                type="button"
                onClick={commit}
                className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
              >
                <Plus className="size-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  Criar <span className="font-medium">{trimmed}</span>
                </span>
              </button>
            )}

            {filtered.map((o) => {
              const checked = value.includes(o.tag);
              return (
                <div
                  key={o.tag}
                  className="group flex items-center gap-1 rounded-sm pr-1 transition-colors hover:bg-accent"
                >
                  <button
                    type="button"
                    onClick={() => toggle(o.tag)}
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none focus-visible:bg-accent"
                  >
                    <span
                      className={cn(
                        'grid size-4 shrink-0 place-content-center rounded-[4px] border border-input transition-colors [&>svg]:size-3.5',
                        checked && 'border-primary bg-primary text-primary-foreground',
                      )}
                    >
                      {checked && <Check />}
                    </span>
                    <TagBadge tag={o.tag} className="max-w-full truncate" />
                    {o.count > 0 && (
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {o.count}
                      </span>
                    )}
                  </button>
                  {o.persisted && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDelete(o.tag);
                      }}
                      aria-label={`Excluir tag ${o.tag}`}
                      className="grid size-6 shrink-0 place-content-center rounded-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              );
            })}

            {filtered.length === 0 && !canCreate && (
              <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                {options.length === 0
                  ? 'Nenhuma tag ainda. Digite para criar.'
                  : 'Nenhuma tag encontrada.'}
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <DeleteTagDialog
        tag={pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        onConfirm={confirmDelete}
        pending={deleteTag.isPending}
      />
    </div>
  );
}

interface DeleteTagDialogProps {
  tag: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}

/**
 * Confirmação de exclusão global de uma tag. Carrega sob demanda em quais
 * demandas a tag está em uso e as lista, para o usuário decidir com contexto.
 */
function DeleteTagDialog({ tag, onOpenChange, onConfirm, pending }: DeleteTagDialogProps) {
  const { data: usage, isLoading } = useTaskTagUsage(tag);

  return (
    <AlertDialog open={!!tag} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir tag</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>
              A tag <span className="font-medium text-foreground">{tag}</span> será
              removida de todas as demandas. Esta ação não pode ser desfeita.
            </p>
            {isLoading ? (
              <p className="flex items-center gap-2">
                <Spinner className="size-4" />
                Verificando onde a tag está em uso…
              </p>
            ) : (usage?.length ?? 0) === 0 ? (
              <p>Esta tag não está sendo usada em nenhuma demanda no momento.</p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-foreground">
                  Em uso em {usage!.length}{' '}
                  {usage!.length === 1 ? 'demanda' : 'demandas'}:
                </p>
                <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                  {usage!.map((t) => (
                    <li key={t.id} className="truncate">
                      <span className="font-medium text-foreground">{t.title}</span>
                      <span> · {t.project.name}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? 'Excluindo…' : 'Excluir tag'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
