import { useState } from 'react';
import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PopoverContent } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { extractApiMessage } from '@/lib/api-error';
import { useCan } from '@/hooks/use-can';
import { useCatalogo, useCreateCatalogItem, useDeleteCatalogItem } from './api/hooks';
import { comItemAtual } from './lib/options';
import { CATALOG_SINGULAR } from './catalogos';
import type { CatalogItem, CatalogKind } from './api/types';

interface CatalogSelectProps {
  kind: CatalogKind;
  value?: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  /**
   * Item já gravado no registro que está sendo editado, mesmo que tenha sido
   * excluído do catálogo. Sem isto, abrir uma oportunidade cujo tipo de serviço
   * sumiu apagaria o valor do campo.
   */
  currentItem?: CatalogItem | null;
  /** Rótulo da opção que limpa a seleção. Sem ele, não há como desmarcar. */
  clearLabel?: string;
  disabled?: boolean;
  id?: string;
  'aria-invalid'?: boolean;
}

/**
 * Seletor de item de catálogo com cadastro e exclusão embutidos — **o** campo de
 * tipo de serviço, fonte de lead, motivo de perda e tipo de atividade; não monte
 * um `Select` cru para os quatro. É o análogo do `TagSelect` para valores de
 * escolha única.
 *
 * Todo o ciclo de vida acontece aqui: digitar um nome que não existe e confirmar
 * cadastra, a lixeira exclui. Não existe renomear — troca-se o item por outro, e
 * cada registro segue exibindo o nome que valia quando foi classificado. Por
 * isso nenhum dos quatro catálogos tem tela em Administração.
 *
 * A única exceção é o item com `isFollowUp` (o tipo primitivo 'Follow-up', em
 * `tipos-de-atividade`): ele não oferece lixeira, porque é por ele que os
 * lembretes diários e o bloco "Próximas ações" do painel encontram as atividades
 * agendadas — e nenhuma rota move essa marca para outro tipo. O backend responde
 * 422 de todo jeito; esconder o botão é só não oferecer o que não pode.
 *
 * Cadastrar e excluir exigem `catalogo:gerenciar`; sem a permissão o componente
 * vira um seletor comum, porque o backend responderia 403.
 *
 * **Sem diálogo de confirmação, de propósito:** excluir aqui não destrói
 * histórico (item em uso vira invisível e os registros antigos mantêm o nome) e
 * cadastrar o mesmo nome de novo ressuscita a linha original. É reversível, ao
 * contrário da exclusão de tag — que tira a tag de todos os registros e por isso
 * confirma.
 */
export function CatalogSelect({
  kind,
  value,
  onChange,
  placeholder,
  currentItem,
  clearLabel,
  disabled,
  id,
  'aria-invalid': ariaInvalid,
}: CatalogSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const { can } = useCan();
  const podeGerenciar = can('catalogo:gerenciar');

  const { data } = useCatalogo(kind);
  const create = useCreateCatalogItem(kind);
  const remove = useDeleteCatalogItem(kind);

  const singular = CATALOG_SINGULAR[kind];
  const itens = comItemAtual(data, currentItem);
  const selecionado = itens.find((i) => i.id === value);

  const trimmed = search.trim();
  const query = trimmed.toLowerCase();
  const filtrados = query
    ? itens.filter((i) => i.name.toLowerCase().includes(query))
    : itens;
  /** Item já existente com exatamente o texto digitado (ignorando caixa). */
  const jaExiste = trimmed
    ? itens.find((i) => i.name.toLowerCase() === query)
    : undefined;
  const podeCadastrar = podeGerenciar && trimmed.length >= 2 && !jaExiste;

  const escolher = (itemId: string | null) => {
    onChange(itemId);
    setOpen(false);
    setSearch('');
  };

  /** Enter ou clique em "Cadastrar": seleciona o existente ou cria o digitado. */
  const confirmarTexto = async () => {
    if (!trimmed) return;
    if (jaExiste) {
      escolher(jaExiste.id);
      return;
    }
    if (!podeCadastrar) return;
    try {
      const criado = await create.mutateAsync({ name: trimmed });
      escolher(criado.id);
      toast.success(`${criado.name} cadastrado.`);
    } catch (err) {
      toast.error(extractApiMessage(err, `Falha ao cadastrar o ${singular}.`));
    }
  };

  const excluir = async (item: CatalogItem) => {
    try {
      const { ocultado, usos } = await remove.mutateAsync(item.id);
      if (value === item.id) onChange(null);
      toast.success(
        ocultado
          ? `${item.name} excluído. ${usos} ${usos === 1 ? 'registro que já usava continua exibindo' : 'registros que já usavam continuam exibindo'} o nome.`
          : `${item.name} excluído.`,
      );
    } catch (err) {
      toast.error(extractApiMessage(err, `Falha ao excluir o ${singular}.`));
    }
  };

  return (
    <PopoverPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverPrimitive.Trigger
        id={id}
        disabled={disabled}
        aria-invalid={ariaInvalid}
        className={cn(
          'flex h-10 w-full items-center gap-2 rounded-lg border border-border bg-transparent px-3 text-sm transition-colors outline-none select-none dark:bg-input/30',
          'hover:border-ring/60 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
          !selecionado && 'text-muted-foreground',
        )}
      >
        <span className="flex-1 truncate text-left">
          {selecionado?.name ?? placeholder ?? `Selecione o ${singular}`}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
      </PopoverPrimitive.Trigger>

      <PopoverContent align="start" className="w-(--anchor-width) min-w-64 p-0">
        <div className="p-2">
          <SearchInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={
              podeGerenciar ? `Buscar ou cadastrar ${singular}…` : 'Buscar…'
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void confirmarTexto();
              }
            }}
          />
        </div>

        <div className="max-h-64 overflow-y-auto p-1 pt-0">
          {podeCadastrar && (
            <button
              type="button"
              onClick={() => void confirmarTexto()}
              disabled={create.isPending}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
            >
              {create.isPending ? (
                <Spinner className="size-4 shrink-0" />
              ) : (
                <Plus className="size-4 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">
                Cadastrar <span className="font-medium">{trimmed}</span>
              </span>
            </button>
          )}

          {clearLabel && !query && (
            <button
              type="button"
              onClick={() => escolher(null)}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground outline-none select-none hover:bg-accent focus-visible:bg-accent"
            >
              <span className="size-4 shrink-0" />
              <span className="truncate">{clearLabel}</span>
            </button>
          )}

          {filtrados.map((item) => (
            <div
              key={item.id}
              className="group flex items-center gap-1 rounded-sm pr-1 transition-colors hover:bg-accent"
            >
              <button
                type="button"
                onClick={() => escolher(item.id)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none focus-visible:bg-accent"
              >
                <span className="size-4 shrink-0 [&>svg]:size-4">
                  {item.id === value && <Check />}
                </span>
                <span className="truncate">{item.name}</span>
              </button>

              {podeGerenciar && !item.isFollowUp && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void excluir(item);
                  }}
                  disabled={remove.isPending}
                  aria-label={`Excluir ${item.name}`}
                  className="grid size-6 shrink-0 place-content-center rounded-sm text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none"
                >
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}

          {filtrados.length === 0 && !podeCadastrar && (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {itens.length === 0
                ? podeGerenciar
                  ? `Nenhum ${singular} ainda. Digite para cadastrar.`
                  : `Nenhum ${singular} cadastrado.`
                : 'Nada encontrado.'}
            </p>
          )}
        </div>
      </PopoverContent>
    </PopoverPrimitive.Root>
  );
}
