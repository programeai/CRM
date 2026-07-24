import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { CheckIcon, ChevronDownIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { SearchInput } from "@/components/ui/search-input"
import { PopoverContent } from "@/components/ui/popover"

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  /** Opções disponíveis para seleção. */
  options: MultiSelectOption[]
  /** Valores atualmente selecionados. */
  value: string[]
  /** Callback disparado a cada alteração da seleção. */
  onValueChange: (value: string[]) => void
  /** Texto exibido quando nada está selecionado. */
  placeholder?: string
  /** Placeholder do campo de busca. */
  searchPlaceholder?: string
  /** Texto exibido quando a busca não retorna opções. */
  emptyText?: string
  /** Classe extra para o gatilho (ex.: largura). */
  className?: string
  /** Classe extra para o popover. */
  contentClassName?: string
}

/**
 * Select de múltipla escolha com busca. Cada opção é um item marcável;
 * o gatilho resume a seleção ("N selecionados") e permite limpar tudo.
 */
export function MultiSelect({
  options,
  value,
  onValueChange,
  placeholder = "Selecione…",
  searchPlaceholder = "Buscar…",
  emptyText = "Nenhum resultado.",
  className,
  contentClassName,
}: MultiSelectProps) {
  const [search, setSearch] = React.useState("")

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => o.label.toLowerCase().includes(q))
  }, [options, search])

  const toggle = (v: string) => {
    onValueChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v])
  }

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation()
    onValueChange([])
  }
  const stop = (e: React.PointerEvent) => e.stopPropagation()

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? (options.find((o) => o.value === value[0])?.label ?? `${value.length} selecionado`)
        : `${value.length} selecionados`

  return (
    <PopoverPrimitive.Root onOpenChange={(open) => !open && setSearch("")}>
      <PopoverPrimitive.Trigger
        data-slot="multi-select-trigger"
        className={cn(
          "flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 text-sm whitespace-nowrap transition-colors outline-none select-none",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4 [&_svg]:shrink-0",
          className,
        )}
      >
        <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
          {summary}
        </span>
        <span className="flex items-center gap-1 text-muted-foreground">
          {value.length > 0 && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Limpar seleção"
              onPointerDown={stop}
              onClick={clear}
              className="grid place-content-center rounded-sm hover:text-foreground"
            >
              <XIcon />
            </span>
          )}
          <ChevronDownIcon />
        </span>
      </PopoverPrimitive.Trigger>
      <PopoverContent
        align="start"
        className={cn("w-(--anchor-width) min-w-56 p-0", contentClassName)}
      >
        <div className="p-2">
          <SearchInput
            autoFocus
            value={search}
            onValueChange={setSearch}
            placeholder={searchPlaceholder}
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1 pt-0">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            filtered.map((o) => {
              const checked = value.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => toggle(o.value)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
                >
                  <span
                    className={cn(
                      "grid size-4 shrink-0 place-content-center rounded-[4px] border border-input transition-colors [&>svg]:size-3.5",
                      checked && "border-primary bg-primary text-primary-foreground",
                    )}
                  >
                    {checked && <CheckIcon />}
                  </span>
                  <span className="truncate">{o.label}</span>
                </button>
              )
            })
          )}
        </div>
      </PopoverContent>
    </PopoverPrimitive.Root>
  )
}
