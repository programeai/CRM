import { Link, type LinkProps } from "react-router"
import { cn } from "@/lib/utils"

/**
 * Link padrão para nome/título em uma linha de listagem. Ao clicar no nome de um
 * item listado, o usuário abre a tela de visualização desse item.
 *
 * Padrão do projeto: toda listagem cujo item tenha tela de visualização deve
 * envolver o nome/título com este componente. `stopPropagation` evita disparar
 * duas vezes quando a própria linha (`<TableRow>`) também navega.
 */
function TableLink({ className, onClick, ...props }: LinkProps) {
  return (
    <Link
      data-slot="table-link"
      className={cn(
        "rounded-sm font-medium text-foreground transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
      {...props}
    />
  )
}

export { TableLink }
