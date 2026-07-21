import * as React from "react"
import { ListFilter, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface ColumnFilterProps {
  /** Rótulo da coluna, exibido ao lado do ícone de filtro. */
  label: string
  /** Indica se há algum filtro aplicado — destaca o ícone. */
  active: boolean
  /** Controles de filtro renderizados dentro do popover. */
  children: React.ReactNode
  /** Classe extra para o conteúdo do popover (ex.: largura). */
  contentClassName?: string
  /** Limpa todos os filtros desta coluna — botão só aparece quando `active`. */
  onClear?: () => void
}

/**
 * Cabeçalho de coluna com filtro embutido: mostra o rótulo e um ícone de funil
 * que abre um popover com os controles de filtro. O ícone fica destacado quando
 * há filtro ativo.
 */
export function ColumnFilter({ label, active, children, contentClassName, onClear }: ColumnFilterProps) {
  return (
    <div className="flex items-center gap-1">
      <span>{label}</span>
      <Popover>
        <PopoverTrigger
          aria-label={`Filtrar por ${label}`}
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            active && "bg-primary/10 text-primary hover:bg-primary/20",
          )}
        >
          <ListFilter className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent align="start" className={cn("w-64", contentClassName)}>
          {children}
          {active && onClear && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="mt-3 w-full justify-start text-muted-foreground"
            >
              <X className="mr-2 size-3.5" />
              Limpar filtro
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
