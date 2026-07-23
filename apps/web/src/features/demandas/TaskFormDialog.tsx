import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { TASK_PRIORITY_LABELS, translateTaskPriority } from '@/lib/labels';
import { extractApiMessage } from './lib/api-error';
import { useCreateTask, useUpdateTask } from './api/hooks';
import { ChecklistEditor } from './components/ChecklistEditor';
import type { Task, TaskPriority } from './api/types';

const schema = z.object({
  title: z.string().min(2, 'O título deve ter no mínimo 2 caracteres.'),
  description: z.string().optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  dueDate: z.string().optional(),
  tags: z.array(z.string()).optional(),
  checklist: z.array(z.object({ text: z.string().min(1, 'Informe o texto.'), done: z.boolean() })).optional(),
});
export type TaskFormValues = z.infer<typeof schema>;
type Values = TaskFormValues;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task;
  defaultProjectId: string;
}

export function TaskFormDialog({ open, onOpenChange, task, defaultProjectId }: Props) {
  const isEdit = !!task;
  const createTask = useCreateTask();
  const updateTask = useUpdateTask(task?.id ?? '');

  const { register, handleSubmit, control, reset, formState: { errors, isSubmitting } } =
    useForm<Values>({
      resolver: zodResolver(schema),
      defaultValues: { title: '', priority: 'MEDIUM', tags: [], checklist: [] },
    });

  useEffect(() => {
    if (!open) return;
    reset(
      task
        ? {
            title: task.title,
            description: task.description ?? '',
            priority: task.priority,
            dueDate: task.dueDate?.slice(0, 10) ?? '',
            tags: task.tags,
            checklist: task.checklist ?? [],
          }
        : { title: '', priority: 'MEDIUM', tags: [], checklist: [] },
    );
  }, [open, task, reset]);

  const onSubmit = async (v: Values) => {
    const body = {
      title: v.title.trim(),
      description: v.description || undefined,
      priority: v.priority,
      dueDate: v.dueDate || undefined,
      tags: v.tags ?? [],
      checklist: v.checklist ?? [],
    };
    try {
      if (isEdit) {
        await updateTask.mutateAsync(body);
        toast.success('Tarefa atualizada.');
      } else {
        await createTask.mutateAsync({ ...body, projectId: defaultProjectId });
        toast.success('Tarefa criada.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar a tarefa.' : 'Falha ao criar a tarefa.',
        ),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tarefa' : 'Nova tarefa'}</DialogTitle>
          <DialogDescription>Dados da tarefa.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="task-form"
          >
            <Field className="sm:col-span-2" data-invalid={!!errors.title}>
              <FieldLabel htmlFor="title" required>Título</FieldLabel>
              <Input id="title" aria-invalid={!!errors.title} {...register('title')} />
              {errors.title && <FieldError>{errors.title.message}</FieldError>}
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="description">Descrição</FieldLabel>
              <textarea
                id="description"
                rows={3}
                className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                {...register('description')}
              />
            </Field>

            <Field>
              <FieldLabel required>Prioridade</FieldLabel>
              <Controller
                control={control}
                name="priority"
                render={({ field }) => (
                  <Select<TaskPriority> items={TASK_PRIORITY_LABELS} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger />
                    <SelectContent>
                      {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => (
                        <SelectItem key={p} value={p}>
                          {translateTaskPriority(p)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="dueDate">Prazo</FieldLabel>
              <Input id="dueDate" type="date" {...register('dueDate')} />
            </Field>

            <Field className="sm:col-span-2">
              <FieldLabel htmlFor="tags">Tags</FieldLabel>
              <Controller
                control={control}
                name="tags"
                render={({ field }) => (
                  <Input
                    id="tags"
                    placeholder="Separe por vírgula"
                    value={(field.value ?? []).join(', ')}
                    onChange={(e) =>
                      field.onChange(
                        e.target.value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean),
                      )
                    }
                  />
                )}
              />
            </Field>

            <ChecklistEditor control={control} register={register} errors={errors} />
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar tarefa'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
