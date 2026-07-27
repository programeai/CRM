import { useEffect, useState } from 'react';
import { useOutletContext } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { CheckCircle2, Clock, History, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { AssigneeSelect } from '@/components/ui/assignee-select';
import { Spinner } from '@/components/ui/spinner';
import { formatDateTime } from '@/lib/format';
import { useMe } from '@/features/perfil/api/hooks';
import {
  useActivities,
  useCreateActivity,
  useCompleteActivity,
} from '../api/hooks';
import type { Client } from '../api/types';
import { useCatalogo } from '@/features/catalogos/api/hooks';

const schema = z.object({
  typeId: z.string().uuid('Selecione o tipo.'),
  content: z.string().min(1, 'O conteúdo é obrigatório.'),
  scheduledFor: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
});
type Values = z.infer<typeof schema>;

export default function TimelineTab() {
  const client = useOutletContext<Client>();
  const clientId = client.id;
  const { data, isLoading } = useActivities(clientId);
  const createActivity = useCreateActivity(clientId);
  const completeActivity = useCompleteActivity(clientId);
  // Registrar uma atividade é um ato de quem está logado — o responsável já nasce
  // preenchido com ele (e pode ser trocado antes de salvar).
  const { data: me } = useMe();
  // Só os tipos ativos: o tipo de um registro NOVO tem de estar utilizável (é o
  // mesmo 422 que `assertUtilizavel` devolveria no servidor).
  const { data: tipos } = useCatalogo('tipos-de-atividade');

  const [dialogOpen, setDialogOpen] = useState(false);

  const empty = (): Values => ({
    typeId: '',
    content: '',
    scheduledFor: '',
    assigneeId: me?.id ?? null,
  });

  const {
    register,
    handleSubmit,
    control,
    watch,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: empty() });

  const typeId = watch('typeId');
  // A REGRA vem do catálogo (`isFollowUp`), não de um literal — antes este
  // predicado divergia das duas queries do servidor.
  const tipoSelecionadoEhFollowUp = !!tipos?.find((t) => t.id === typeId)
    ?.isFollowUp;

  // O `me` pode chegar depois da montagem do formulário: assim que chega, o campo
  // (ainda intocado) passa a refletir o usuário logado.
  useEffect(() => {
    if (me?.id && getValues('assigneeId') == null) setValue('assigneeId', me.id);
  }, [me?.id, getValues, setValue]);

  const openCreate = () => {
    reset(empty());
    setDialogOpen(true);
  };

  const onSubmit = async (v: Values) => {
    try {
      await createActivity.mutateAsync({
        clientId,
        typeId: v.typeId,
        content: v.content.trim(),
        scheduledFor:
          tipoSelecionadoEhFollowUp && v.scheduledFor
            ? new Date(v.scheduledFor).toISOString()
            : undefined,
        assigneeId: v.assigneeId ?? null,
      });
      toast.success('Atividade registrada.');
      setDialogOpen(false);
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="font-heading text-sm font-medium">Timeline</h2>
        <Button size="sm" onClick={openCreate}>
          <Plus data-icon="inline-start" />
          Nova atividade
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : activities.length > 0 ? (
        <ol className="flex flex-col gap-2">
          {activities.map((activity) => {
            // Predicado ÚNICO de follow-up pendente, derivado da regra do
            // catálogo. Antes esta linha divergia das duas queries do servidor,
            // que filtravam por `type === 'FOLLOW_UP'`.
            const pendingFollowUp =
              !!activity.type.isFollowUp &&
              !!activity.scheduledFor &&
              !activity.completedAt;
            return (
              <li
                key={activity.id}
                className="flex items-start justify-between gap-4 rounded-lg border p-3"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {activity.type.name}
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
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <History />
            </EmptyMedia>
            <EmptyTitle>Nenhuma atividade</EmptyTitle>
            <EmptyDescription>
              Registre a primeira atividade deste cliente.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova atividade</DialogTitle>
            <DialogDescription>
              Registre o que aconteceu com este cliente.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form onSubmit={handleSubmit(onSubmit)} id="activity-form">
              <FieldGroup>
                <Field>
                  <FieldLabel required>Tipo</FieldLabel>
                  <Controller
                    control={control}
                    name="typeId"
                    render={({ field }) => (
                      <Select<string>
                        value={field.value}
                        onValueChange={(v) => field.onChange(v ?? '')}
                      >
                        <SelectTrigger placeholder="Selecione o tipo" />
                        <SelectContent>
                          {(tipos ?? []).map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.typeId && (
                    <FieldError>{errors.typeId.message}</FieldError>
                  )}
                </Field>
                <Field>
                  <FieldLabel>Responsável</FieldLabel>
                  <Controller
                    control={control}
                    name="assigneeId"
                    render={({ field }) => (
                      <AssigneeSelect
                        value={field.value}
                        onValueChange={field.onChange}
                      />
                    )}
                  />
                </Field>
                {tipoSelecionadoEhFollowUp && (
                  <Field>
                    <FieldLabel htmlFor="activity-scheduledFor">
                      Agendar para
                    </FieldLabel>
                    <input
                      id="activity-scheduledFor"
                      type="datetime-local"
                      className="h-10 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      {...register('scheduledFor')}
                    />
                  </Field>
                )}
                <Field data-invalid={!!errors.content}>
                  <FieldLabel htmlFor="activity-content" required>
                    Conteúdo
                  </FieldLabel>
                  <textarea
                    id="activity-content"
                    rows={4}
                    placeholder="Descreva o que aconteceu…"
                    aria-invalid={!!errors.content}
                    className="min-h-24 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive"
                    {...register('content')}
                  />
                  {errors.content && (
                    <FieldError>{errors.content.message}</FieldError>
                  )}
                </Field>
              </FieldGroup>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button type="submit" form="activity-form" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Registrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
