import { CalendarClock, CalendarOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { followUpLabel, followUpState } from '@/lib/follow-up';

interface Props {
  nextActivityAt?: string | null;
  className?: string;
}

/**
 * Sinal de "próximo passo" do card do funil.
 *
 * O caso importante é o `nenhum`: uma oportunidade sem follow-up agendado é a que
 * está sendo esquecida, e o quadro precisa dizer isso sem alarmar como um erro —
 * daí a borda tracejada em vez de uma cor. `atrasado` é o único destructive.
 */
export function NextActivityBadge({ nextActivityAt, className }: Props) {
  const estado = followUpState(nextActivityAt);
  const Icone = estado === 'nenhum' ? CalendarOff : CalendarClock;
  return (
    <Badge
      variant={
        estado === 'atrasado'
          ? 'destructive'
          : estado === 'hoje'
            ? 'default'
            : 'outline'
      }
      className={cn(
        'gap-1 font-normal',
        estado === 'nenhum' && 'border-dashed text-muted-foreground',
        className,
      )}
    >
      <Icone className="size-3" />
      {followUpLabel(nextActivityAt)}
    </Badge>
  );
}
