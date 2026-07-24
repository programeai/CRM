import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/ui/search-input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger,
} from '@/components/ui/select';
import { SERVICE_TYPE_LABELS, PROJECT_STATUS_LABELS, translateServiceType, translateProjectStatus } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions } from '@/lib/clients-lookup';
import { useCreateProject, useUpdateProject } from './api/hooks';
import type { Project, ProjectStatus, ServiceType } from './api/types';

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  status: z.enum(['ACTIVE', 'PAUSED', 'DONE', 'CANCELED']).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project?: Project;
  defaultClientId?: string;
}

export function ProjectFormDialog({ open, onOpenChange, project, defaultClientId }: Props) {
  const isEdit = !!project;
  const createProject = useCreateProject();
  const updateProject = useUpdateProject(project?.id ?? '');

  const [clientSearch, setClientSearch] = useState('');
  const debounced = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debounced);

  const [selectOpen, setSelectOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [createdClients, setCreatedClients] = useState<{ id: string; name: string }[]>([]);

  const { register, handleSubmit, control, reset, setValue, formState: { errors, isSubmitting } } =
    useForm<Values>({
      resolver: zodResolver(schema),
      defaultValues: { name: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    });

  useEffect(() => {
    if (!open) return;
    setCreatedClients([]);
    reset(
      project
        ? {
            name: project.name,
            clientId: project.clientId,
            serviceType: project.serviceType,
            status: project.status,
            startDate: project.startDate?.slice(0, 10) ?? '',
            dueDate: project.dueDate?.slice(0, 10) ?? '',
          }
        : { name: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    );
  }, [open, project, defaultClientId, reset]);

  /** Lista exibida no select: recém-criados + resultados da busca, sem duplicar. */
  const clientChoices = [
    ...createdClients,
    ...(clientOptions ?? []).filter((c) => !createdClients.some((n) => n.id === c.id)),
  ];

  const handleClientCreated = (client: Client) => {
    setCreatedClients((prev) =>
      prev.some((c) => c.id === client.id)
        ? prev
        : [{ id: client.id, name: client.name }, ...prev],
    );
    setValue('clientId', client.id, { shouldValidate: true });
  };

  const onSubmit = async (v: Values) => {
    const body = {
      name: v.name.trim(),
      clientId: v.clientId,
      serviceType: v.serviceType,
      status: v.status,
      startDate: v.startDate || undefined,
      dueDate: v.dueDate || undefined,
    };
    try {
      if (isEdit) {
        const { clientId: _omit, ...patch } = body;
        await updateProject.mutateAsync(patch);
        toast.success('Projeto atualizado.');
      } else {
        await createProject.mutateAsync(body);
        toast.success('Projeto criado.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar o projeto.' : 'Falha ao criar o projeto.',
        ),
      );
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar projeto' : 'Novo projeto'}</DialogTitle>
          <DialogDescription>Dados do projeto.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="project-form"
          >
            <Field className="sm:col-span-2" data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name" required>Nome</FieldLabel>
              <Input id="name" aria-invalid={!!errors.name} {...register('name')} />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            {/* Seletor de cliente — oculto quando defaultClientId (aba do cliente) */}
            {!defaultClientId && (
              <Field className="sm:col-span-2" data-invalid={!!errors.clientId}>
                <FieldLabel required>Cliente</FieldLabel>
                <Controller
                  control={control}
                  name="clientId"
                  render={({ field }) => (
                    <Select<string>
                      open={selectOpen}
                      onOpenChange={setSelectOpen}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger />
                      <SelectContent>
                        <div className="p-2">
                          <SearchInput
                            placeholder="Buscar cliente…"
                            value={clientSearch}
                            onValueChange={setClientSearch}
                          />
                        </div>
                        {clientChoices.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                        <SelectSeparator />
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-primary outline-none hover:bg-accent"
                          onClick={() => {
                            setSelectOpen(false);
                            setClientFormOpen(true);
                          }}
                        >
                          <Plus className="size-4 shrink-0" />
                          Cadastrar novo cliente
                        </button>
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.clientId && <FieldError>{errors.clientId.message}</FieldError>}
              </Field>
            )}

            <Field>
              <FieldLabel required>Tipo de serviço</FieldLabel>
              <Controller
                control={control}
                name="serviceType"
                render={({ field }) => (
                  <Select<ServiceType> items={SERVICE_TYPE_LABELS} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger />
                    <SelectContent>
                      {(Object.keys(SERVICE_TYPE_LABELS) as ServiceType[]).map((s) => (
                        <SelectItem key={s} value={s}>
                          {translateServiceType(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            {isEdit && (
              <Field>
                <FieldLabel required>Status</FieldLabel>
                <Controller
                  control={control}
                  name="status"
                  render={({ field }) => (
                    <Select<ProjectStatus>
                      items={PROJECT_STATUS_LABELS}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger />
                      <SelectContent>
                        {(Object.keys(PROJECT_STATUS_LABELS) as ProjectStatus[]).map((s) => (
                          <SelectItem key={s} value={s}>
                            {translateProjectStatus(s)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="startDate">Início</FieldLabel>
              <Input id="startDate" type="date" {...register('startDate')} />
            </Field>

            <Field>
              <FieldLabel htmlFor="dueDate">Prazo</FieldLabel>
              <Input id="dueDate" type="date" {...register('dueDate')} />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="project-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar projeto'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <ClientFormDialog
      open={clientFormOpen}
      onOpenChange={setClientFormOpen}
      onCreated={handleClientCreated}
    />
    </>
  );
}
