import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CalendarClock, CheckCircle2, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError } from '@/components/ui/field';
import { AssigneeSelect } from '@/components/ui/assignee-select';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { useCan } from '@/hooks/use-can';
import { formatDateTime } from '@/lib/format';
import { followUpState } from '@/lib/follow-up';
import { cn } from '@/lib/utils';
import { useMe } from '@/features/perfil/api/hooks';
import { useCatalogo } from '@/features/catalogos/api/hooks';
import { CatalogSelect } from '@/features/catalogos/CatalogSelect';
import { useActivities, useCompleteActivity, useCreateActivity } from './api/hooks';
import type { Activity, ActivityScope } from './api/types';

const schema = z.object({
  typeId: z.string().uuid('Selecione o tipo.'),
  content: z.string().min(1, 'O conteúdo é obrigatório.'),
  scheduledFor: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
});
type Values = z.infer<typeof schema>;

/**
 * Predicado ÚNICO de follow-up pendente, derivado da REGRA do catálogo
 * (`type.isFollowUp`) — o mesmo que o servidor usa no cron de lembretes, no
 * dashboard e no `nextActivityAt` do card do funil.
 */
function pendente(activity: Activity): boolean {
  return (
    !!activity.type.isFollowUp &&
    !!activity.scheduledFor &&
    !activity.completedAt
  );
}

interface Props extends ActivityScope {
  /** Texto do estado vazio — muda entre a timeline do cliente e a da oportunidade. */
  emptyDescription: string;
}

/**
 * Timeline de atividades de um recorte (cliente, ou uma oportunidade dele).
 *
 * O composer é **inline**, não um modal: registrar uma anotação ou agendar um
 * follow-up é o ato mais frequente do dia e não deve custar a abertura de um
 * diálogo. Ver `ActivityScope` para o que `dealId` muda.
 */
export function ActivityTimeline({ clientId, dealId, emptyDescription }: Props) {
  const scope: ActivityScope = dealId ? { clientId, dealId } : { clientId };
  const { data, isLoading } = useActivities(scope);
  const createActivity = useCreateActivity();
  const completeActivity = useCompleteActivity();
  const { can } = useCan();
  const podeRegistrar = can('cliente:gerenciar');
  // Registrar uma atividade é um ato de quem está logado — o responsável já nasce
  // preenchido com ele (e pode ser trocado antes de salvar).
  const { data: me } = useMe();
  // Só os tipos ativos: o tipo de um registro NOVO tem de estar utilizável (é o
  // mesmo 422 que `assertUtilizavel` devolveria no servidor).
  const { data: tipos } = useCatalogo('tipos-de-atividade');

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { typeId: '', content: '', scheduledFor: '', assigneeId: null },
  });

  const typeId = watch('typeId');
  // A REGRA vem do catálogo (`isFollowUp`), não de um literal — antes este
  // predicado divergia das duas queries do servidor.
  const tipoSelecionadoEhFollowUp = !!tipos?.find((t) => t.id === typeId)?.isFollowUp;

  // O `me` pode chegar depois da montagem do formulário: assim que chega, o campo
  // (ainda intocado) passa a refletir o usuário logado.
  useEffect(() => {
    if (me?.id && getValues('assigneeId') == null) setValue('assigneeId', me.id);
  }, [me?.id, getValues, setValue]);

  const onSubmit = async (v: Values) => {
    try {
      await createActivity.mutateAsync({
        clientId,
        // A atividade nasce vinculada à oportunidade quando registrada por lá —
        // é isso que faz a timeline dela existir (o campo era write-only antes).
        dealId,
        typeId: v.typeId,
        content: v.content.trim(),
        scheduledFor:
          tipoSelecionadoEhFollowUp && v.scheduledFor
            ? new Date(v.scheduledFor).toISOString()
            : undefined,
        assigneeId: v.assigneeId ?? null,
      });
      toast.success('Atividade registrada.');
      // Mantém tipo e responsável: registrar duas anotações seguidas é comum.
      reset({ ...getValues(), content: '', scheduledFor: '' });
    } catch {
      toast.error('Falha ao registrar a atividade.');
    }
  };

  const concluir = async (id: string) => {
    try {
      await completeActivity.mutateAsync(id);
      toast.success('Follow-up concluído.');
    } catch {
      toast.error('Falha ao concluir o follow-up.');
    }
  };

  const activities = data?.data ?? [];
  // Planejado no topo, em ordem de vencimento; o resto vira histórico. O que
  // ainda vai acontecer é o que exige ação — a ordem cronológica pura enterrava
  // o follow-up de amanhã sob as anotações de hoje.
  const planejado = activities
    .filter(pendente)
    .sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''));
  const historico = activities.filter((a) => !pendente(a));

  return (
    <div className="flex flex-col gap-4">
      {podeRegistrar && (
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="flex flex-col gap-3 rounded-lg border p-3"
        >
          <Field data-invalid={!!errors.content}>
            <textarea
              rows={3}
              placeholder="Registre uma anotação ou agende um follow-up…"
              aria-label="Conteúdo da atividade"
              aria-invalid={!!errors.content}
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive dark:bg-input/30"
              {...register('content')}
            />
            {errors.content && <FieldError>{errors.content.message}</FieldError>}
          </Field>

          <div className="flex flex-wrap items-start gap-2">
            <Field className="min-w-40 flex-1" data-invalid={!!errors.typeId}>
              {/* Cadastrar e excluir tipo acontece aqui dentro — tipos de
                  atividade não têm tela de configuração, como os outros três
                  catálogos. O 'Follow-up' não oferece lixeira. */}
              <Controller
                control={control}
                name="typeId"
                render={({ field }) => (
                  <CatalogSelect
                    kind="tipos-de-atividade"
                    value={field.value}
                    onChange={(id) => field.onChange(id ?? '')}
                    aria-invalid={!!errors.typeId}
                  />
                )}
              />
              {errors.typeId && <FieldError>{errors.typeId.message}</FieldError>}
            </Field>

            <Field className="min-w-40 flex-1">
              <Controller
                control={control}
                name="assigneeId"
                render={({ field }) => (
                  <AssigneeSelect value={field.value} onValueChange={field.onChange} />
                )}
              />
            </Field>

            {tipoSelecionadoEhFollowUp && (
              <Field className="min-w-44 flex-1">
                <input
                  type="datetime-local"
                  aria-label="Agendar para"
                  className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  {...register('scheduledFor')}
                />
              </Field>
            )}

            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Registrar
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : activities.length > 0 ? (
        <div className="flex flex-col gap-4">
          {planejado.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Planejado</h3>
              <ol className="flex flex-col gap-2">
                {planejado.map((activity) => (
                  <ActivityRow
                    key={activity.id}
                    activity={activity}
                    onConcluir={() => void concluir(activity.id)}
                    concluindo={completeActivity.isPending}
                  />
                ))}
              </ol>
            </section>
          )}
          {historico.length > 0 && (
            <section className="flex flex-col gap-2">
              {planejado.length > 0 && (
                <h3 className="text-xs font-medium text-muted-foreground">Histórico</h3>
              )}
              <ol className="flex flex-col gap-2">
                {historico.map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </ol>
            </section>
          )}
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>Nenhuma atividade</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}

interface RowProps {
  activity: Activity;
  onConcluir?: () => void;
  concluindo?: boolean;
}

function ActivityRow({ activity, onConcluir, concluindo }: RowProps) {
  const estado = pendente(activity) ? followUpState(activity.scheduledFor) : 'nenhum';
  return (
    <li className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{activity.type.name}</Badge>
          {estado !== 'nenhum' && (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                estado === 'atrasado' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              <CalendarClock className="size-3" />
              {formatDateTime(activity.scheduledFor)}
              {estado === 'atrasado' && ' · atrasado'}
            </span>
          )}
          {activity.completedAt && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 className="size-3" />
              Concluído
            </span>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap">{activity.content}</p>
        <span className="text-xs text-muted-foreground">
          {formatDateTime(activity.createdAt)}
          {activity.assignee && <> · {activity.assignee.name}</>}
        </span>
      </div>
      {onConcluir && (
        <Button variant="outline" size="sm" disabled={concluindo} onClick={onConcluir}>
          Concluir
        </Button>
      )}
    </li>
  );
}
