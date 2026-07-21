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
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger,
} from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { SERVICE_TYPE_LABELS, translateServiceType } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions, useCreateDeal, useUpdateDeal } from './api/hooks';
import type { Deal, ServiceType } from './api/types';

const schema = z.object({
  title: z.string().min(2, 'O título deve ter no mínimo 2 caracteres.'),
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  amount: z.number().min(0).optional(),
  probability: z
    .number()
    .int()
    .min(0, 'A probabilidade deve estar entre 0 e 100.')
    .max(100, 'A probabilidade deve estar entre 0 e 100.')
    .optional(),
  expectedClose: z.string().optional(),
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
      defaultValues: { title: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    });

  useEffect(() => {
    if (!open) return;
    setCreatedClients([]);
    reset(
      deal
        ? {
            title: deal.title,
            clientId: deal.clientId,
            serviceType: deal.serviceType,
            amount: deal.amount != null ? Number(deal.amount) : undefined,
            probability: deal.probability ?? undefined,
            expectedClose: deal.expectedClose?.slice(0, 10) ?? '',
          }
        : { title: '', clientId: defaultClientId ?? '', serviceType: 'SOFTWARE' },
    );
  }, [open, deal, defaultClientId, reset]);

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
      title: v.title.trim(),
      clientId: v.clientId,
      serviceType: v.serviceType,
      amount: v.amount && v.amount > 0 ? v.amount : undefined,
      probability: v.probability,
      expectedClose: v.expectedClose || undefined,
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
              <Input id="title" aria-invalid={!!errors.title} {...register('title')} />
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
                      open={selectOpen}
                      onOpenChange={setSelectOpen}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger />
                      <SelectContent>
                        <div className="p-2">
                          <Input
                            placeholder="Buscar cliente…"
                            value={clientSearch}
                            onChange={(e) => setClientSearch(e.target.value)}
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
                  <Select<ServiceType> value={field.value} onValueChange={field.onChange}>
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
                aria-invalid={!!errors.probability}
                {...register('probability', { setValueAs: (v) => (v === '' ? undefined : Number(v)) })}
              />
              {errors.probability && <FieldError>{errors.probability.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="expectedClose">Fechamento previsto</FieldLabel>
              <Input id="expectedClose" type="date" {...register('expectedClose')} />
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="deal-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar oportunidade'}
          </Button>
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
    </>
  );
}
