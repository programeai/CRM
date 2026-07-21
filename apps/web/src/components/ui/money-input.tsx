import * as React from "react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Converte um valor numérico (em reais) para a string mascarada "R$ 1.234,56". */
function format(value: number): string {
  return currencyFormatter.format(value)
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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = parseDigitsToNumber(e.target.value)
    if (value === undefined) setInternal(next)
    onValueChange?.(next)
  }

  return (
    <Input
      type="text"
      inputMode={inputMode}
      value={format(numericValue)}
      onChange={handleChange}
      className={cn("text-right tabular-nums", className)}
      {...props}
    />
  )
}

export { MoneyInput }
