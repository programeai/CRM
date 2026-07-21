import * as React from "react"
import { Inbox, type LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div className="relative w-full overflow-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      // Zebrado padrão do sistema: linhas pares recebem um tom sutil para
      // facilitar a leitura. Hover e seleção (mais escuros) continuam visíveis.
      className={cn("[&_tr:last-child]:border-0 [&_tr:nth-child(even)]:bg-muted/40", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn("border-t bg-muted/50 font-medium [&>tr]:last:border-b-0", className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("border-b transition-colors hover:bg-muted/50 data-[state=selected]:bg-muted", className)}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />
  )
}

interface TableEmptyProps extends React.ComponentProps<"td"> {
  /** Quantidade de colunas da tabela, para que a célula ocupe a largura toda. */
  colSpan: number
  /** Ícone exibido acima da mensagem. Padrão: caixa vazia. */
  icon?: LucideIcon
  /** Mensagem de estado vazio. Deve estar em pt-BR. */
  children: React.ReactNode
}

/**
 * Linha de estado vazio para o corpo de uma tabela: mantém a tabela visível
 * (cabeçalho incluso) e exibe um ícone com uma mensagem quando não há registros.
 */
function TableEmpty({ colSpan, icon: Icon = Inbox, className, children, ...props }: TableEmptyProps) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell data-slot="table-empty" colSpan={colSpan} className={cn("h-40 text-center", className)} {...props}>
        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
          <Icon className="h-8 w-8 opacity-40" aria-hidden />
          <span className="text-sm">{children}</span>
        </div>
      </TableCell>
    </TableRow>
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
  TableEmpty,
}
