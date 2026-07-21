import { useOutletContext } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { ACTIVITY_TYPE_LABELS, translateActivityType } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';
import {
  useActivities,
  useCreateActivity,
  useCompleteActivity,
} from '../api/hooks';
import type { ActivityType, Client } from '../api/types';

const schema = z.object({
  type: z.enum(['NOTE', 'CALL', 'MEETING', 'EMAIL', 'WHATSAPP', 'FOLLOW_UP']),
  content: z.string().min(1, 'O conteúdo é obrigatório.'),
  scheduledFor: z.string().optional(),
});
type Values = z.infer<typeof schema>;

export default function TimelineTab() {
  const client = useOutletContext<Client>();
  const clientId = client.id;
  const { data, isLoading } = useActivities(clientId);
  const createActivity = useCreateActivity(clientId);
  const completeActivity = useCompleteActivity(clientId);

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'NOTE', content: '', scheduledFor: '' },
  });

  const type = watch('type');

  const onSubmit = async (v: Values) => {
    try {
      await createActivity.mutateAsync({
        clientId,
        type: v.type,
        content: v.content.trim(),
        scheduledFor:
          v.type === 'FOLLOW_UP' && v.scheduledFor
            ? new Date(v.scheduledFor).toISOString()
            : undefined,
      });
      toast.success('Atividade registrada.');
      reset({ type: 'NOTE', content: '', scheduledFor: '' });
    } catch {
      toast.error('Falha ao registrar a atividade.');
    }
  };

  const complete = async (id: string) => {
    try {
      await completeActivity.mutateAsync(id);
      toast.success('Follow-up concluído.');
    } catch {
      toast.error('Falha ao concluir o follow-up.');
    }
  };

  const activities = data?.data ?? [];

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={handleSubmit(onSubmit)}
        className="flex flex-col gap-3 rounded-lg border p-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row">
          <Field className="sm:max-w-48">
            <FieldLabel required>Tipo</FieldLabel>
            <Controller
              control={control}
              name="type"
              render={({ field }) => (
                <Select<ActivityType>
                  value={field.value}
                  onValueChange={(v) => field.onChange(v)}
                >
                  <SelectTrigger />
                  <SelectContent>
                    {(Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[]).map(
                      (t) => (
                        <SelectItem key={t} value={t}>
                          {translateActivityType(t)}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {type === 'FOLLOW_UP' && (
            <Field className="sm:max-w-56">
              <FieldLabel htmlFor="scheduledFor">Agendar para</FieldLabel>
              <input
                id="scheduledFor"
                type="datetime-local"
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                {...register('scheduledFor')}
              />
            </Field>
          )}
        </div>
        <Field data-invalid={!!errors.content}>
          <FieldLabel htmlFor="content" required>Conteúdo</FieldLabel>
          <textarea
            id="content"
            rows={3}
            aria-invalid={!!errors.content}
            className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
            {...register('content')}
          />
          {errors.content && <FieldError>{errors.content.message}</FieldError>}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Registrar
          </Button>
        </div>
      </form>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : activities.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {activities.map((activity) => {
            const pendingFollowUp =
              !!activity.scheduledFor && !activity.completedAt;
            return (
              <li
                key={activity.id}
                className="flex items-start justify-between gap-4 rounded-lg border p-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {translateActivityType(activity.type)}
                    </Badge>
                    {pendingFollowUp && (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {formatDateTime(activity.scheduledFor)}
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
                  </span>
                </div>
                {pendingFollowUp && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void complete(activity.id)}
                  >
                    Concluir
                  </Button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma atividade registrada ainda.
        </p>
      )}
    </div>
  );
}
