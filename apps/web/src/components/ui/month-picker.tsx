import * as React from "react"
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const MONTHS_SHORT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez",
] as const

const MONTHS_LONG = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
] as const

const pad = (n: number) => String(n).padStart(2, "0")

/** Decompõe `AAAA-MM` em ano e índice de mês (0..11). */
function parse(value: string): { year: number; month: number } {
  const [y, m] = value.split("-").map(Number)
  return { year: y, month: m - 1 }
}

/**
 * Seletor de mês estilo calendário: um Popover com o ano no cabeçalho (entre as
 * setas de avançar/retroceder) e uma grade dos 12 meses. `value`/`onChange` no
 * formato `AAAA-MM`.
 */
export function MonthPicker({
  value,
  onChange,
  className,
  align = "end",
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  align?: "start" | "center" | "end"
}) {
  const [open, setOpen] = React.useState(false)
  const { year: selectedYear, month: selectedMonth } = parse(value)
  const [viewYear, setViewYear] = React.useState(selectedYear)

  // Ao abrir, mostra o ano do mês selecionado.
  const handleOpenChange = (next: boolean) => {
    if (next) setViewYear(selectedYear)
    setOpen(next)
  }

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth()

  const pick = (month: number) => {
    onChange(`${viewYear}-${pad(month + 1)}`)
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button variant="outline" className={cn("justify-start font-normal", className)} />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {MONTHS_LONG[selectedMonth]} de {selectedYear}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 p-3">
        <div className="relative mb-2 flex h-8 items-center justify-center">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Ano anterior"
            onClick={() => setViewYear((y) => y - 1)}
            className="absolute left-0"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium">{viewYear}</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo ano"
            onClick={() => setViewYear((y) => y + 1)}
            className="absolute right-0"
          >
            <ChevronRight />
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {MONTHS_SHORT.map((label, i) => {
            const isSelected = viewYear === selectedYear && i === selectedMonth
            const isCurrent = viewYear === currentYear && i === currentMonth
            return (
              <button
                key={label}
                type="button"
                onClick={() => pick(i)}
                className={cn(
                  "flex h-9 items-center justify-center rounded-md text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  !isSelected && "hover:bg-muted",
                  isSelected &&
                    "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
                  !isSelected && isCurrent && "font-medium text-primary",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}
