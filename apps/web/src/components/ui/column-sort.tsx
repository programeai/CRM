import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export type SortDir = "asc" | "desc"

export interface ColumnSortOption {
  /** Chave de ordenação associada à opção. */
  key: string
  /** Direção da ordenação. */
  dir: SortDir
  /** Rótulo exibido na lista. */
  label: string
}

interface ColumnSortProps {
  /** Rótulo da coluna, exibido ao lado do ícone de ordenação. */
  label: string
  /** Opções de ordenação oferecidas por esta coluna. */
  options: ColumnSortOption[]
  /** Chave de ordenação ativa no momento. */
  activeKey: string
  /** Direção de ordenação ativa no momento. */
  activeDir: SortDir
  /** Aplica a ordenação escolhida. */
  onChange: (key: string, dir: SortDir) => void
  /** Remove a ordenação desta coluna — botão só aparece quando ativa. */
  onClear?: () => void
  /** Classe extra para o conteúdo do popover (ex.: largura). */
  contentClassName?: string
  /** Classe extra do container do cabeçalho (ex.: `justify-end`). */
  className?: string
}

/**
 * Cabeçalho de coluna com ordenação embutida: mostra o rótulo e um ícone que
 * abre um popover com as opções de ordenação (chave + direção). O ícone fica
 * destacado e indica a direção quando esta coluna está ordenando.
 */
export function ColumnSort({
  label,
  options,
  activeKey,
  activeDir,
  onChange,
  onClear,
  contentClassName,
  className,
}: ColumnSortProps) {
  const active = options.some((o) => o.key === activeKey && o.dir === activeDir)
  const Icon = !active ? ArrowUpDown : activeDir === "asc" ? ArrowUp : ArrowDown

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span>{label}</span>
      <Popover>
        <PopoverTrigger
          aria-label={`Ordenar por ${label}`}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            active && "bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          <Icon className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" className={cn("w-52 p-2", contentClassName)}>
          <div className="space-y-1">
            {options.map((opt) => {
              const selected = opt.key === activeKey && opt.dir === activeDir
              return (
                <button
                  key={`${opt.key}:${opt.dir}`}
                  type="button"
                  onClick={() => onChange(opt.key, opt.dir)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted",
                    selected && "bg-muted font-medium",
                  )}
                >
                  {opt.dir === "asc" ? (
                    <ArrowUp className="size-3.5 text-muted-foreground" />
                  ) : (
                    <ArrowDown className="size-3.5 text-muted-foreground" />
                  )}
                  {opt.label}
                </button>
              )
            })}
          </div>
          {active && onClear && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="mt-2 w-full justify-start text-muted-foreground"
            >
              <X className="mr-2 size-3.5" />
              Remover ordenação
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
