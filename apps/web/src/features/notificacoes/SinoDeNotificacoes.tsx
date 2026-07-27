import { useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { Bell } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { extractApiMessage } from '@/lib/api-error';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  useMarcarLida,
  useMarcarTodasLidas,
  useNaoLidas,
  useNotificacoes,
} from './api/hooks';
import type { Notificacao } from './api/types';

/** Acima disto o badge para de contar e mostra "9+". */
const MAX_NO_BADGE = 9;

export function SinoDeNotificacoes() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const { data: naoLidas } = useNaoLidas();
  // A lista só é buscada com o popover aberto — o polling é só da contagem.
  const {
    data: lista,
    isLoading,
    isError,
  } = useNotificacoes({ enabled: open });
  const marcarLida = useMarcarLida();
  const marcarTodasLidas = useMarcarTodasLidas();

  const count = naoLidas?.count ?? 0;
  const itens = lista?.data ?? [];

  const abrir = async (n: Notificacao) => {
    setOpen(false);
    // A leitura não bloqueia a navegação: se falhar, a pessoa ainda chega ao
    // registro e o badge se corrige no próximo polling.
    if (!n.readAt) {
      try {
        await marcarLida.mutateAsync(n.id);
      } catch (err) {
        toast.error(extractApiMessage(err, 'Falha ao marcar como lida.'));
      }
    }
    if (n.link) navigate(n.link);
  };

  const lerTodas = async () => {
    try {
      await marcarTodasLidas.mutateAsync();
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Falha ao marcar todas como lidas.'),
      );
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="relative rounded-full"
            aria-label={
              count > 0
                ? `Notificações — ${count} não lida(s)`
                : 'Notificações'
            }
          />
        }
      >
        <Bell />
        {count > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-bold text-primary-foreground"
          >
            {count > MAX_NO_BADGE ? `${MAX_NO_BADGE}+` : count}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-88 p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <h3 className="text-sm font-medium">Notificações</h3>
          {count > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={marcarTodasLidas.isPending}
              onClick={() => void lerTodas()}
            >
              {marcarTodasLidas.isPending
                ? 'Marcando…'
                : 'Marcar todas como lidas'}
            </Button>
          )}
        </div>

        {isError ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            Falha ao carregar as notificações.
          </p>
        ) : isLoading ? (
          <div className="flex flex-col gap-2 p-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : itens.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Bell />
              </EmptyMedia>
              <EmptyTitle>Nenhuma notificação</EmptyTitle>
              <EmptyDescription>
                Avisamos aqui quando algo precisar da sua atenção.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          // Não existe `scroll-area.tsx` no projeto — a rolagem é
          // `max-h-* overflow-y-auto`, o padrão do `dialog.tsx`.
          <ul className="max-h-96 divide-y overflow-y-auto">
            {itens.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void abrir(n)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-accent"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      n.readAt ? 'bg-transparent' : 'bg-primary',
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {n.title}
                    </span>
                    <span className="block text-sm text-muted-foreground">
                      {n.body}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
