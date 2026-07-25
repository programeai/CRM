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
import { SERVICE_TYPE_LABELS, translateServiceType } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions, buildClientItems } from '@/lib/clients-lookup';
import { useCreateProposal, useUpdateProposal } from './api/hooks';
import { ItemsEditor } from './components/ItemsEditor';
import type { Proposal, ServiceType } from './api/types';

const schema = z.object({
  clientId: z.string().uuid('Selecione um cliente.'),
  serviceType: z.enum(['SOFTWARE', 'WEBSITE', 'PAID_TRAFFIC']),
  items: z
    .array(
      z.object({
        description: z.string().min(1, 'Descrição obrigatória.'),
        quantity: z.number().min(0, 'Quantidade inválida.'),
        unitPrice: z.number().min(0, 'Valor inválido.'),
      }),
    )
    .min(1, 'Adicione ao menos um item.'),
  discount: z.number().min(0).optional(),
  scope: z.string().optional(),
  paymentTerms: z.string().optional(),
  deliveryTime: z.string().optional(),
  validUntil: z.string().optional(),
});
export type ProposalFormValues = z.infer<typeof schema>;
type Values = ProposalFormValues;

const EMPTY: Values = {
  clientId: '',
  serviceType: 'SOFTWARE',
  items: [{ description: '', quantity: 1, unitPrice: 0 }],
  discount: 0,
  scope: '',
  paymentTerms: '',
  deliveryTime: '',
  validUntil: '',
};

function toValues(proposal: Proposal): Values {
  return {
    clientId: proposal.clientId,
    serviceType: proposal.serviceType,
    items: proposal.items.map((it) => ({
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
    })),
    discount: proposal.discount != null ? Number(proposal.discount) : 0,
    scope: proposal.scope ?? '',
    paymentTerms: proposal.paymentTerms ?? '',
    deliveryTime: proposal.deliveryTime ?? '',
    validUntil: proposal.validUntil?.slice(0, 10) ?? '',
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal?: Proposal;
  defaultClientId?: string;
}

/** Cria/edita propostas (RHF+Zod) com editor de itens; edição só permitida em DRAFT. */
export function ProposalFormDialog({ open, onOpenChange, proposal, defaultClientId }: Props) {
  const isEdit = !!proposal;
  const createProposal = useCreateProposal();
  const updateProposal = useUpdateProposal(proposal?.id ?? '');

  const [clientSearch, setClientSearch] = useState('');
  const debounced = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debounced);

  const [selectOpen, setSelectOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [createdClients, setCreatedClients] = useState<{ id: string; name: string }[]>([]);

  const {
    register, handleSubmit, control, reset, setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    setCreatedClients([]);
    reset(
      proposal
        ? toValues(proposal)
        : { ...EMPTY, clientId: defaultClientId ?? '' },
    );
  }, [open, proposal, defaultClientId, reset]);

  const clientChoices = [
    ...createdClients,
    ...(clientOptions ?? []).filter((c) => !createdClients.some((n) => n.id === c.id)),
  ];
  const clientItems = buildClientItems(clientChoices, proposal?.client);

  const handleClientCreated = (client: Client) => {
    setCreatedClients((prev) =>
      prev.some((c) => c.id === client.id) ? prev : [{ id: client.id, name: client.name }, ...prev],
    );
    setValue('clientId', client.id, { shouldValidate: true });
  };

  const onSubmit = async (v: Values) => {
    const body = {
      clientId: v.clientId,
      serviceType: v.serviceType,
      items: v.items,
      discount: v.discount && v.discount > 0 ? v.discount : undefined,
      scope: v.scope || undefined,
      paymentTerms: v.paymentTerms || undefined,
      deliveryTime: v.deliveryTime || undefined,
      validUntil: v.validUntil || undefined,
    };
    try {
      if (isEdit) {
        const { clientId: _omit, ...patch } = body;
        await updateProposal.mutateAsync(patch);
        toast.success('Proposta atualizada.');
      } else {
        await createProposal.mutateAsync(body);
        toast.success('Proposta criada.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar a proposta.' : 'Falha ao criar a proposta.',
        ),
      );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Editar proposta' : 'Nova proposta'}</DialogTitle>
            <DialogDescription>Dados da proposta e itens.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              className="grid grid-cols-1 gap-6 lg:grid-cols-[1.8fr_1fr] lg:items-start"
              onSubmit={handleSubmit(onSubmit)}
              id="proposal-form"
            >
              {/* Coluna esquerda (maior): escopo e itens */}
              <div className="order-2 flex flex-col gap-4 lg:order-1">
                <Field>
                  <FieldLabel htmlFor="scope">Escopo</FieldLabel>
                  <textarea
                    id="scope"
                    rows={5}
                    placeholder="Descreva o escopo da proposta…"
                    className="min-h-32 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    {...register('scope')}
                  />
                </Field>

                <ItemsEditor control={control} register={register} errors={errors} />
              </div>

              {/* Coluna direita: demais dados da proposta */}
              <div className="order-1 flex flex-col gap-4 lg:order-2">
                {!defaultClientId && (
                  <Field data-invalid={!!errors.clientId}>
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

                <Field>
                  <FieldLabel htmlFor="validUntil">Válida até</FieldLabel>
                  <Input id="validUntil" type="date" {...register('validUntil')} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="paymentTerms">Condições de pagamento</FieldLabel>
                  <Input id="paymentTerms" placeholder="Ex.: 50% na aprovação, 50% na entrega" {...register('paymentTerms')} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="deliveryTime">Prazo de entrega</FieldLabel>
                  <Input id="deliveryTime" placeholder="Ex.: 30 dias úteis" {...register('deliveryTime')} />
                </Field>
              </div>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="proposal-form" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {isEdit ? 'Salvar' : 'Criar proposta'}
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
