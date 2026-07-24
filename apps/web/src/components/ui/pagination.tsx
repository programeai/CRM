import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface PaginationProps {
  /** Página atual (base 1). */
  page: number
  /** Quantidade de itens por página. */
  pageSize: number
  /** Total de itens (de todas as páginas). */
  total: number
  /** Chamado com a nova página ao navegar. */
  onPageChange: (page: number) => void
  /** Rótulo do item no singular (ex.: "cobrança"). */
  labelSingular: string
  /** Rótulo do item no plural (ex.: "cobranças"). */
  labelPlural: string
  className?: string
}

/**
 * Rodapé de paginação padrão das listagens.
 *
 * Exibe "Mostrando de X a Y de Z <itens>" e os controles Anterior/Próxima.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  labelSingular,
  labelPlural,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  const noun = total === 1 ? labelSingular : labelPlural

  return (
    <div
      className={cn(
        "flex items-center justify-between text-sm text-muted-foreground",
        className,
      )}
    >
      <span>
        {total === 0
          ? `Nenhum resultado`
          : `Mostrando de ${from} a ${to} de ${total} ${noun}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPageChange(Math.max(1, page - 1))}
        >
          Anterior
        </Button>
        <span>
          Página {page} de {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        >
          Próxima
        </Button>
      </div>
    </div>
  )
}
