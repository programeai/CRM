import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

const numberFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Converte um valor numérico (em reais) para a string mascarada "1.234,56" (sem o símbolo). */
function format(value: number): string {
  return numberFormatter.format(value)
}

/** Extrai apenas os dígitos e interpreta os dois últimos como centavos. */
function parseDigitsToNumber(raw: string): number {
  const digits = raw.replace(/\D/g, "")
  if (!digits) return 0
  return Number(digits) / 100
}

type MoneyInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "type" | "value" | "defaultValue" | "onChange"
> & {
  /** Valor em reais (ex.: 1234.56). Sempre inicia zerado quando omitido. */
  value?: number
  /** Recebe o valor numérico em reais a cada digitação. */
  onValueChange?: (value: number) => void
}

function MoneyInput({
  value,
  onValueChange,
  className,
  inputMode = "numeric",
  ...props
}: MoneyInputProps) {
  // Componente não-controlado começa sempre zerado (R$ 0,00).
  const [internal, setInternal] = React.useState(0)
  const numericValue = value ?? internal
  const inputRef = React.useRef<HTMLInputElement>(null)

  // Os dígitos sempre entram pela direita (centavos), então o cursor é
  // mantido no fim: digitar ou apagar em qualquer posição tem o mesmo efeito.
  const moveCaretToEnd = React.useCallback(() => {
    const el = inputRef.current
    if (!el) return
    const end = el.value.length
    if (el.selectionStart !== end || el.selectionEnd !== end) {
      el.setSelectionRange(end, end)
    }
  }, [])

  React.useLayoutEffect(() => {
    if (document.activeElement === inputRef.current) moveCaretToEnd()
  }, [numericValue, moveCaretToEnd])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseDigitsToNumber(e.target.value)
    if (value === undefined) setInternal(next)
    onValueChange?.(next)
    moveCaretToEnd()
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground select-none">
        R$
      </span>
      <Input
        ref={inputRef}
        type="text"
        inputMode={inputMode}
        value={format(numericValue)}
        onChange={handleChange}
        onFocus={moveCaretToEnd}
        onClick={moveCaretToEnd}
        onSelect={moveCaretToEnd}
        className={cn("pl-10 text-right tabular-nums", className)}
        {...props}
      />
    </div>
  )
}

export { MoneyInput }
