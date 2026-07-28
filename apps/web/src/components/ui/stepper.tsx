import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface StepperStep {
  label: string
}

/**
 * Indicador de passo horizontal. Sem navegação própria — quem controla o
 * passo atual é a página (o wizard de importação, por ora).
 */
export function Stepper({
  steps,
  current,
  className,
}: {
  steps: StepperStep[]
  /** Índice do passo atual (0-based). Passos com índice menor ficam marcados como concluídos. */
  current: number
  className?: string
}) {
  return (
    <ol className={cn("flex items-center", className)}>
      {steps.map((step, i) => {
        const concluido = i < current
        const atual = i === current
        return (
          <li key={step.label} className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-medium",
                  concluido && "border-primary bg-primary text-primary-foreground",
                  atual && "border-primary text-primary",
                  !concluido && !atual && "border-border text-muted-foreground",
                )}
              >
                {concluido ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                className={cn(
                  "text-sm font-medium",
                  atual ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <span aria-hidden="true" className="mx-3 h-px w-8 bg-border sm:w-12" />
            )}
          </li>
        )
      })}
    </ol>
  )
}
