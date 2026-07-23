import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

import { cn } from "@/lib/utils"

export type SortDirection = "asc" | "desc"

interface SortButtonProps {
  /** Rótulo da coluna. */
  label: string
  /** Direção ativa desta coluna, ou `null` quando a ordenação é por outra coluna. */
  direction: SortDirection | null
  /** Alterna a ordenação por esta coluna (asc → desc → asc…). */
  onSort: () => void
}

/**
 * Cabeçalho de coluna clicável para ordenar a listagem. Mostra uma seta ↑/↓
 * quando é a coluna ativa e um ícone neutro (esmaecido) quando não é.
 */
export function SortButton({ label, direction, onSort }: SortButtonProps) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ChevronsUpDown
  return (
    <button
      type="button"
      onClick={onSort}
      aria-label={`Ordenar por ${label}`}
      className={cn(
        "-mx-1 inline-flex items-center gap-1 rounded-md px-1 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        direction && "text-foreground",
      )}
    >
      {label}
      <Icon className={cn("size-3.5", !direction && "opacity-40")} />
    </button>
  )
}
