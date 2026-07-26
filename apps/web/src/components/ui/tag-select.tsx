import { useEffect, useMemo, useRef, useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
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
import { PopoverContent } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Spinner } from '@/components/ui/spinner';
import { TagBadge } from '@/components/ui/tag-badge';
import { tagColors } from '@/lib/tag-color';
import { cn } from '@/lib/utils';

/** Uma tag já existente no domínio e em quantos registros ela é usada. */
export interface TagOption {
  tag: string;
  count: number;
}

/** Registro que usa a tag, para a lista do diálogo de exclusão. */
export interface TagUsageRef {
  id: string;
  /** Texto principal (ex.: título da demanda, nome do cliente). */
  label: string;
  /** Complemento opcional exibido depois de " · " (ex.: nome do projeto). */
  hint?: string;
}

/**
 * Como nomear, nos textos do diálogo, o registro que carrega a tag.
 * Ex.: `{ singular: 'demanda', plural: 'demandas', gender: 'f' }`.
 */
export interface TagEntityLabels {
  singular: string;
  plural: string;
  gender: 'f' | 'm';
}

interface TagSelectProps {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags existentes do domínio com contagem de uso — alimenta o autocomplete. */
  options?: TagOption[];
  /**
   * Pede a exclusão global de uma tag. A confirmação NÃO pode ser renderizada
   * aqui: este componente costuma viver dentro do `DialogContent` de um modal,
   * que é desmontado quando soterrado por outro modal. Quem usa renderiza o
   * `TagDeleteDialog` como irmão do `Dialog`. Sem o callback, a lixeira não
   * aparece (seletor somente de leitura/escrita da seleção).
   */
  onRequestDeleteTag?: (tag: string) => void;
  /** Ao remontar (modal voltando ao topo), foca o gatilho do seletor. */
  autoFocus?: boolean;
  /** Avisa o pai que o foco automático já foi aplicado (para ele resetar o flag). */
  onAutoFocused?: () => void;
}

interface Option extends TagOption {
  /** Se já existe no servidor (autoriza a exclusão global). */
  persisted: boolean;
}

/**
 * Seletor de tags com busca e criação inline — **o** seletor de tags da
 * aplicação; não monte outro campo de tags (nem input de texto separado por
 * vírgula). As tags existentes vêm de quem usa o componente (`options`, a
 * agregação do domínio); digitar uma que não existe e confirmar com Enter a
 * cadastra na hora (fica salva quando o registro é salvo). A lixeira em cada
 * tag existente dispara `onRequestDeleteTag` — a confirmação é do pai.
 */
export function TagSelect({
  value,
  onChange,
  options: existingTags,
  onRequestDeleteTag,
  autoFocus,
  onAutoFocused,
}: TagSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Ao remontar com `autoFocus` (modal reaberto após a confirmação), devolve o
  // foco ao gatilho. Duplo rAF: garante rodar depois que o próprio Dialog
  // reassenta o foco inicial ao voltar ao topo da pilha.
  useEffect(() => {
    if (!autoFocus) return;
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => {
        triggerRef.current?.focus();
        onAutoFocused?.();
      });
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const options = useMemo<Option[]>(() => {
    const map = new Map<string, Option>();
    for (const t of existingTags ?? []) {
      map.set(t.tag, { tag: t.tag, count: t.count, persisted: true });
    }
    // Tags selecionadas mas ainda não salvas aparecem na lista (sem lixeira).
    for (const t of value) {
      if (!map.has(t)) map.set(t, { tag: t, count: 0, persisted: false });
    }
    return [...map.values()].sort(
      (a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR'),
    );
  }, [existingTags, value]);

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
    onRequestDeleteTag?.(tag);
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

      <PopoverPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverPrimitive.Trigger
          ref={triggerRef}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-sm text-muted-foreground transition-colors outline-none select-none dark:bg-input/30',
            'hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          )}
        >
          <Tag className="size-4 shrink-0" />
          <span className="flex-1 text-left">Buscar ou criar tag…</span>
          <ChevronDown className="size-4 shrink-0" />
        </PopoverPrimitive.Trigger>
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
                  {o.persisted && onRequestDeleteTag && (
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
      </PopoverPrimitive.Root>
    </div>
  );
}

interface TagDeleteDialogProps {
  /** Tag a excluir; `null` mantém o diálogo fechado. */
  tag: string | null;
  onOpenChange: (open: boolean) => void;
  /** Registros que usam a tag, carregados sob demanda por quem monta o diálogo. */
  usage?: TagUsageRef[];
  /** Carregando a lista de uso. */
  isLoading?: boolean;
  /** Exclusão em andamento (desabilita o botão). */
  isDeleting?: boolean;
  onConfirm: () => void;
  entity: TagEntityLabels;
}

/**
 * Confirmação de exclusão global de uma tag. Deve ser renderizado como IRMÃO do
 * modal que contém o `TagSelect` (não dentro dele) — assim sobrevive ao
 * soterramento e o modal de baixo reabre intacto ao fechar. A busca do uso e a
 * mutação de exclusão ficam com quem usa o componente (cada domínio tem as
 * suas rotas de tags); aqui só entra a apresentação.
 */
export function TagDeleteDialog({
  tag,
  onOpenChange,
  usage,
  isLoading,
  isDeleting,
  onConfirm,
  entity,
}: TagDeleteDialogProps) {
  const all = entity.gender === 'f' ? 'todas as' : 'todos os';
  const none = entity.gender === 'f' ? 'nenhuma' : 'nenhum';
  const count = usage?.length ?? 0;

  return (
    <AlertDialog open={!!tag} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir tag</AlertDialogTitle>
          <AlertDialogDescription render={<div />} className="flex flex-col gap-2">
            <p>
              A tag <span className="font-medium text-foreground">{tag}</span> será
              removida de {all} {entity.plural}. Esta ação não pode ser desfeita.
            </p>
            {isLoading ? (
              <p className="flex items-center gap-2">
                <Spinner className="size-4" />
                Verificando onde a tag está em uso…
              </p>
            ) : count === 0 ? (
              <p>
                Esta tag não está sendo usada em {none} {entity.singular} no momento.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                <p className="font-medium text-foreground">
                  Em uso em {count} {count === 1 ? entity.singular : entity.plural}:
                </p>
                <ul className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
                  {usage!.map((u) => (
                    <li key={u.id} className="truncate">
                      <span className="font-medium text-foreground">{u.label}</span>
                      {u.hint && <span> · {u.hint}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? 'Excluindo…' : 'Excluir tag'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
