import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import type { FunnelStage } from '../api/types';

/** Cor da barra conforme o tipo de estágio (aberto = marca; ganho/perdido = semântico). */
function barClass(stage: FunnelStage): string {
  if (stage.isWon) return 'bg-emerald-500 dark:bg-emerald-400';
  if (stage.isLost) return 'bg-muted-foreground/40';
  return 'bg-primary';
}

/**
 * Funil de oportunidades: uma barra por estágio, largura proporcional à
 * contagem do estágio mais cheio. Mostra quantidade e valor por estágio.
 */
export function Funnel({ stages }: { stages: FunnelStage[] }) {
  const maxCount = Math.max(1, ...stages.map((s) => s.count));

  if (stages.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum estágio de pipeline configurado.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {stages.map((stage) => (
        <li key={stage.stageId} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="font-medium">{stage.name}</span>
            <span className="text-muted-foreground">
              {stage.count} · {formatMoney(stage.amount)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all', barClass(stage))}
              style={{ width: `${(stage.count / maxCount) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
