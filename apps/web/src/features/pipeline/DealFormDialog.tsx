import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Archive, Plus } from 'lucide-react';
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
import { MoneyInput } from '@/components/ui/money-input';
import { AssigneeSelect } from '@/components/ui/assignee-select';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { useCan } from '@/hooks/use-can';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions, buildClientItems } from '@/lib/clients-lookup';
import { useArchiveDeal, useCreateDeal, useUpdateDeal } from './api/hooks';
import type { Deal } from './api/types';
import { CatalogSelect } from '@/features/catalogos/CatalogSelect';

const schema = z.object({
  title: z.string().min(2, 'O título deve ter no mínimo 2 caracteres.'),
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceTypeId: z.string().uuid('Selecione o tipo de serviço.'),
  amount: z.number().min(0).optional(),
  probability: z
    .number()
    .int()
    .min(0, 'A probabilidade deve estar entre 0 e 100.')
    .max(100, 'A probabilidade deve estar entre 0 e 100.')
    .optional(),
  expectedClose: z.string().optional(),
  assigneeId: z.string().nullable().optional(),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal;
  defaultClientId?: string;
}

export function DealFormDialog({ open, onOpenChange, deal, defaultClientId }: Props) {
  const isEdit = !!deal;
  const createDeal = useCreateDeal();
  const updateDeal = useUpdateDeal(deal?.id ?? '');
  const archiveDeal = useArchiveDeal();
  const { can } = useCan();

  const [archiveOpen, setArchiveOpen] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const debounced = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debounced);

  const [selectOpen, setSelectOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  /**
   * Clientes criados a partir deste formulário. Como o lookup de clientes tem
   * chave de cache própria (não invalidada ao criar), injetamos o recém-criado
   * na lista de opções para que ele apareça já selecionado.
   */
  const [createdClients, setCreatedClients] = useState<{ id: string; name: string }[]>([]);

  const { register, handleSubmit, control, reset, setValue, formState: { errors, isSubmitting } } =
    useForm<Values>({
      resolver: zodResolver(schema),
      defaultValues: {
        title: '',
        clientId: defaultClientId ?? '',
        serviceTypeId: '',
        assigneeId: null,
      },
    });

  useEffect(() => {
    if (!open) return;
    setCreatedClients([]);
    reset(
      deal
        ? {
            title: deal.title,
            clientId: deal.clientId,
            serviceTypeId: deal.serviceTypeId,
            amount: deal.amount != null ? Number(deal.amount) : undefined,
            probability: deal.probability ?? undefined,
            expectedClose: deal.expectedClose?.slice(0, 10) ?? '',
            assigneeId: deal.assigneeId ?? null,
          }
        : {
            title: '',
            clientId: defaultClientId ?? '',
            serviceTypeId: '',
            assigneeId: null,
          },
    );
  }, [open, deal, defaultClientId, reset]);

  /** Lista exibida no select: recém-criados + resultados da busca, sem duplicar. */
  const clientChoices = [
    ...createdClients,
    ...(clientOptions ?? []).filter((c) => !createdClients.some((n) => n.id === c.id)),
  ];
  const clientItems = buildClientItems(clientChoices, deal?.client);

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
      title: v.title.trim(),
      clientId: v.clientId,
      serviceTypeId: v.serviceTypeId,
      amount: v.amount && v.amount > 0 ? v.amount : undefined,
      probability: v.probability,
      expectedClose: v.expectedClose || undefined,
      assigneeId: v.assigneeId ?? null,
    };
    try {
      if (isEdit) {
        const { clientId: _omit, ...patch } = body;
        await updateDeal.mutateAsync(patch);
        toast.success('Oportunidade atualizada.');
      } else {
        await createDeal.mutateAsync(body);
        toast.success('Oportunidade criada.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar a oportunidade.' : 'Falha ao criar a oportunidade.',
        ),
      );
    }
  };

  const confirmArchive = async () => {
    if (!deal) return;
    try {
      await archiveDeal.mutateAsync(deal.id);
      toast.success('Oportunidade arquivada.');
      setArchiveOpen(false);
      onOpenChange(false);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao arquivar a oportunidade.'));
      setArchiveOpen(false);
    }
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar oportunidade' : 'Nova oportunidade'}</DialogTitle>
          <DialogDescription>Dados da oportunidade.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="deal-form"
          >
            <Field className="sm:col-span-2" data-invalid={!!errors.title}>
              <FieldLabel htmlFor="title" required>Título</FieldLabel>
              <Input id="title" placeholder="Ex.: Website institucional" aria-invalid={!!errors.title} {...register('title')} />
              {errors.title && <FieldError>{errors.title.message}</FieldError>}
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
                      items={clientItems}
                      open={selectOpen}
                      onOpenChange={setSelectOpen}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger placeholder="Selecione um cliente" />
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
                name="serviceTypeId"
                render={({ field }) => (
                  <CatalogSelect
                    kind="servicos"
                    value={field.value}
                    onChange={(id) => field.onChange(id ?? '')}
                    currentItem={deal?.serviceType}
                    placeholder="Selecione o tipo de serviço"
                    aria-invalid={!!errors.serviceTypeId}
                  />
                )}
              />
              {errors.serviceTypeId && (
                <FieldError>{errors.serviceTypeId.message}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor="amount">Valor</FieldLabel>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput
                    id="amount"
                    value={field.value ?? 0}
                    onValueChange={field.onChange}
                  />
                )}
              />
            </Field>

            <Field data-invalid={!!errors.probability}>
              <FieldLabel htmlFor="probability">Probabilidade (%)</FieldLabel>
              <Input
                id="probability"
                type="number"
                min={0}
                max={100}
                placeholder="0 a 100"
                aria-invalid={!!errors.probability}
                {...register('probability', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })}
              />
              {errors.probability && <FieldError>{errors.probability.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="expectedClose">Fechamento previsto</FieldLabel>
              <Input id="expectedClose" type="date" {...register('expectedClose')} />
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
                    current={deal?.assignee}
                  />
                )}
              />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter className="justify-between">
          {deal && can('oportunidade:gerenciar') ? (
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              onClick={() => setArchiveOpen(true)}
            >
              <Archive data-icon="inline-start" />
              Arquivar
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="deal-form" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {isEdit ? 'Salvar' : 'Criar oportunidade'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Cadastro rápido de cliente: abre por cima e soterra este formulário
        (sem perder o preenchido); ao criar, o cliente já vem selecionado. */}
    <ClientFormDialog
      open={clientFormOpen}
      onOpenChange={setClientFormOpen}
      onCreated={handleClientCreated}
    />

    <ConfirmDialog
      open={archiveOpen}
      onOpenChange={setArchiveOpen}
      title="Arquivar oportunidade"
      description="Ela sai do funil e vai para a lixeira, de onde pode ser restaurada."
      confirmLabel="Arquivar"
      pendingLabel="Arquivando…"
      destructive
      pending={archiveDeal.isPending}
      onConfirm={() => void confirmArchive()}
    />
    </>
  );
}
