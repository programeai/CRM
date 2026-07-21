import * as React from "react"
import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type StatTone = "default" | "positive" | "warning" | "danger"

const TONE_CLASS: Record<StatTone, string> = {
  default: "text-foreground",
  positive: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  danger: "text-destructive",
}

export interface StatCardProps {
  /** Rótulo do indicador (pt-BR). */
  label: string
  /** Valor principal, já formatado. */
  value: React.ReactNode
  /** Texto auxiliar sob o valor (opcional). */
  hint?: React.ReactNode
  /** Cor do valor conforme o significado do indicador. */
  tone?: StatTone
  /** Ícone opcional exibido ao lado do rótulo. */
  icon?: React.ReactNode
  className?: string
}

/**
 * Cartão de indicador (KPI) reutilizável — padroniza o "stat card" antes
 * montado ad hoc em cada tela. O valor recebe a cor do `tone`.
 */
function StatCard({ label, value, hint, tone = "default", icon, className }: StatCardProps) {
  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          {icon}
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={cn("text-2xl font-semibold", TONE_CLASS[tone])}>{value}</p>
        {hint != null && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

export { StatCard }
