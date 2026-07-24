import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/** Intervalo de datas em ISO `AAAA-MM-DD` (formato aceito pela API). */
export interface DateRange {
  from?: string
  to?: string
}

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"] as const
const MONTHS = [
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

/** Converte um `Date` local em ISO `AAAA-MM-DD` sem passar por UTC (evita drift de fuso). */
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Interpreta ISO `AAAA-MM-DD` como data local (meia-noite local, não UTC). */
export function fromISODate(iso?: string): Date | undefined {
  if (!iso) return undefined
  const [y, m, d] = iso.split("-").map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

/**
 * Calendário com seleção de intervalo (`mode="range"` do padrão shadcn).
 * O primeiro clique define o início; o segundo, o fim (reordenando se necessário);
 * um novo clique com o intervalo já completo recomeça a seleção.
 *
 * `numberOfMonths` renderiza N meses consecutivos lado a lado (padrão shadcn para
 * intervalos: 2), com a navegação deslocando todo o bloco de meses.
 */
export function Calendar({
  selected,
  onSelect,
  className,
  numberOfMonths = 1,
}: {
  selected?: DateRange
  onSelect: (range: DateRange) => void
  className?: string
  numberOfMonths?: number
}) {
  const initial = fromISODate(selected?.from) ?? new Date()
  const [view, setView] = React.useState(
    () => new Date(initial.getFullYear(), initial.getMonth(), 1),
  )

  /** Atualiza o intervalo a partir do dia (ISO) clicado. */
  const pick = (iso: string) => {
    if (!selected?.from || selected.to) {
      onSelect({ from: iso, to: undefined })
      return
    }
    if (iso < selected.from) {
      onSelect({ from: iso, to: selected.from })
    } else {
      onSelect({ from: selected.from, to: iso })
    }
  }

  const count = Math.max(1, numberOfMonths)
  const months = Array.from(
    { length: count },
    (_, i) => new Date(view.getFullYear(), view.getMonth() + i, 1),
  )

  return (
    <div className={cn("flex select-none items-start gap-4", className)}>
      {months.map((m, i) => (
        <MonthGrid
          key={`${m.getFullYear()}-${m.getMonth()}`}
          date={m}
          selected={selected}
          onPick={pick}
          onPrev={
            i === 0
              ? () => setView(new Date(view.getFullYear(), view.getMonth() - 1, 1))
              : undefined
          }
          onNext={
            i === count - 1
              ? () => setView(new Date(view.getFullYear(), view.getMonth() + 1, 1))
              : undefined
          }
        />
      ))}
    </div>
  )
}

/** Grade de um único mês. As setas só aparecem nas bordas do bloco (esquerda/direita). */
function MonthGrid({
  date,
  selected,
  onPick,
  onPrev,
  onNext,
}: {
  date: Date
  selected?: DateRange
  onPick: (iso: string) => void
  onPrev?: () => void
  onNext?: () => void
}) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const todayISO = toISODate(new Date())

  const cells: Array<number | null> = [
    ...Array.from({ length: startWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="w-64">
      <div className="relative mb-2 flex h-8 items-center justify-center">
        {onPrev && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mês anterior"
            onClick={onPrev}
            className="absolute left-0"
          >
            <ChevronLeft />
          </Button>
        )}
        <span className="text-sm font-medium">
          {MONTHS[month]} {year}
        </span>
        {onNext && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Próximo mês"
            onClick={onNext}
            className="absolute right-0"
          >
            <ChevronRight />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-7 gap-y-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="flex h-8 items-center justify-center text-xs font-medium text-muted-foreground"
          >
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`empty-${i}`} className="h-8" />
          const iso = toISODate(new Date(year, month, day))
          const isFrom = iso === selected?.from
          const isTo = iso === selected?.to
          const isEndpoint = isFrom || isTo
          const inRange =
            selected?.from &&
            selected?.to &&
            iso > selected.from &&
            iso < selected.to
          const isToday = iso === todayISO
          return (
            <div
              key={iso}
              className={cn(
                "flex h-8 items-center justify-center",
                inRange && "bg-accent",
                isFrom && selected?.to && "rounded-l-md bg-accent",
                isTo && "rounded-r-md bg-accent",
              )}
            >
              <button
                type="button"
                onClick={() => onPick(iso)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  !isEndpoint && "hover:bg-muted",
                  isEndpoint &&
                    "bg-primary font-medium text-primary-foreground hover:bg-primary/90",
                  !isEndpoint && isToday && "font-medium text-primary",
                )}
              >
                {day}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
