import * as React from "react"
import { Calendar as CalendarIcon, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar, fromISODate, type DateRange } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** Formata ISO `AAAA-MM-DD` como `DD/MM/AAAA` (local, sem drift de fuso). */
function formatBR(iso?: string): string {
  const d = fromISODate(iso)
  if (!d) return ""
  return d.toLocaleDateString("pt-BR")
}

function rangeLabel(value?: DateRange): string | null {
  if (!value?.from && !value?.to) return null
  if (value.from && value.to) return `${formatBR(value.from)} – ${formatBR(value.to)}`
  return `${formatBR(value.from)} – …`
}

/**
 * Seletor de intervalo de datas: um único controle (Popover + Calendar) no padrão
 * do design system, substituindo campos `type="date"` soltos.
 */
export function DateRangePicker({
  value,
  onChange,
  placeholder = "Selecione o período",
  className,
  align = "end",
}: {
  value?: DateRange
  onChange: (range: DateRange | undefined) => void
  placeholder?: string
  className?: string
  align?: "start" | "center" | "end"
}) {
  const [open, setOpen] = React.useState(false)
  const label = rangeLabel(value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            className={cn(
              "justify-start font-normal",
              !label && "text-muted-foreground",
              className,
            )}
          />
        }
      >
        <CalendarIcon data-icon="inline-start" />
        {label ?? placeholder}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-auto p-3">
        <Calendar selected={value} onSelect={onChange} />
        {label && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(undefined)}
            className="mt-2 w-full justify-start text-muted-foreground"
          >
            <X data-icon="inline-start" />
            Limpar
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
