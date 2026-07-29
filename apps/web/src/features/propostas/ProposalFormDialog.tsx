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
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger,
} from '@/components/ui/select';
import { MoneyInput } from '@/components/ui/money-input';
import { BILLING_TYPE_LABELS, translateBillingType } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions, buildClientItems } from '@/lib/clients-lookup';
import { useCreateProposal, useUpdateProposal } from './api/hooks';
import { ItemsEditor } from './components/ItemsEditor';
import type { BillingType, Proposal, } from './api/types';
import { CatalogSelect } from '@/features/catalogos/CatalogSelect';

const schema = z
  .object({
    clientId: z.string().uuid('Selecione um cliente.'),
    serviceTypeId: z.string().uuid('Selecione o tipo de serviço.'),
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
    // Plano de cobrança. `billingType` e `startOffsetDays` sem `.optional()`
    // → asterisco obrigatório na label (regra de apps/web/CLAUDE.md).
    billingType: z.enum(['RECURRING', 'INSTALLMENTS', 'ONE_TIME']),
    startOffsetDays: z.number().min(0, 'O prazo não pode ser negativo.').max(365),
    billingDay: z.number().optional(),
    durationMonths: z.number().optional(),
    /** Como a entrada é expressa — é UI, não vai no body. */
    tipoDeEntrada: z.enum(['NENHUMA', 'PERCENTUAL', 'VALOR']),
    downPaymentPercent: z.number().optional(),
    downPaymentAmount: z.number().optional(),
    downPaymentOffsetDays: z.number().optional(),
    installments: z.number().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.billingType === 'RECURRING') {
      if (!v.billingDay || v.billingDay < 1 || v.billingDay > 28) {
        ctx.addIssue({ code: 'custom', path: ['billingDay'], message: 'Dia de vencimento entre 1 e 28.' });
      }
    }
    if (v.billingType === 'INSTALLMENTS') {
      if (!v.installments || v.installments < 1) {
        ctx.addIssue({ code: 'custom', path: ['installments'], message: 'Informe a quantidade de parcelas.' });
      }
      if (v.tipoDeEntrada === 'PERCENTUAL' && !v.downPaymentPercent) {
        ctx.addIssue({ code: 'custom', path: ['downPaymentPercent'], message: 'Informe o percentual da entrada.' });
      }
      if (v.tipoDeEntrada === 'VALOR' && !v.downPaymentAmount) {
        ctx.addIssue({ code: 'custom', path: ['downPaymentAmount'], message: 'Informe o valor da entrada.' });
      }
    }
  });
export type ProposalFormValues = z.infer<typeof schema>;
type Values = ProposalFormValues;

const EMPTY: Values = {
  clientId: '',
  serviceTypeId: '',
  items: [{ description: '', quantity: 1, unitPrice: 0 }],
  discount: 0,
  scope: '',
  paymentTerms: '',
  deliveryTime: '',
  validUntil: '',
  billingType: 'ONE_TIME',
  startOffsetDays: 0,
  tipoDeEntrada: 'NENHUMA',
};

function toValues(proposal: Proposal): Values {
  return {
    clientId: proposal.clientId,
    serviceTypeId: proposal.serviceTypeId,
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
    billingType: proposal.billingType ?? 'ONE_TIME',
    startOffsetDays: proposal.startOffsetDays ?? 0,
    billingDay: proposal.billingDay ?? undefined,
    durationMonths: proposal.durationMonths ?? undefined,
    tipoDeEntrada:
      proposal.downPaymentPercent != null ? 'PERCENTUAL'
      : proposal.downPaymentAmount != null ? 'VALOR'
      : 'NENHUMA',
    downPaymentPercent: proposal.downPaymentPercent != null ? Number(proposal.downPaymentPercent) : undefined,
    downPaymentAmount: proposal.downPaymentAmount != null ? Number(proposal.downPaymentAmount) : undefined,
    downPaymentOffsetDays: proposal.downPaymentOffsetDays ?? undefined,
    installments: proposal.installments ?? undefined,
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  proposal?: Proposal;
  defaultClientId?: string;
  /**
   * Vincula a proposta nova a uma oportunidade — é o que faz ela aparecer no
   * detalhe dela no funil. Só vale na criação: `dealId` não é editável (ver
   * `UpdateProposalBody`, que o omite).
   */
  defaultDealId?: string;
}

/** Cria/edita propostas (RHF+Zod) com editor de itens; edição só permitida em DRAFT. */
export function ProposalFormDialog({
  open,
  onOpenChange,
  proposal,
  defaultClientId,
  defaultDealId,
}: Props) {
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
    register, handleSubmit, control, reset, setValue, watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const billingType = watch('billingType');
  const tipoDeEntrada = watch('tipoDeEntrada');

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
      serviceTypeId: v.serviceTypeId,
      items: v.items,
      discount: v.discount && v.discount > 0 ? v.discount : undefined,
      scope: v.scope || undefined,
      paymentTerms: v.paymentTerms || undefined,
      deliveryTime: v.deliveryTime || undefined,
      validUntil: v.validUntil || undefined,
      billingType: v.billingType,
      startOffsetDays: v.startOffsetDays,
      // Só os campos do regime escolhido: mandar os outros derrubaria em 422
      // no `assertPlanoCoerente` ("plano recorrente não usa entrada…").
      ...(v.billingType === 'RECURRING'
        ? { billingDay: v.billingDay, durationMonths: v.durationMonths || undefined }
        : {}),
      ...(v.billingType === 'INSTALLMENTS'
        ? {
            installments: v.installments,
            ...(v.tipoDeEntrada === 'PERCENTUAL' ? { downPaymentPercent: v.downPaymentPercent } : {}),
            ...(v.tipoDeEntrada === 'VALOR' ? { downPaymentAmount: v.downPaymentAmount } : {}),
            ...(v.tipoDeEntrada !== 'NENHUMA' ? { downPaymentOffsetDays: v.downPaymentOffsetDays ?? 0 } : {}),
          }
        : {}),
    };
    try {
      if (isEdit) {
        const { clientId: _omit, ...patch } = body;
        await updateProposal.mutateAsync(patch);
        toast.success('Proposta atualizada.');
      } else {
        await createProposal.mutateAsync({ ...body, dealId: defaultDealId });
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
                    name="serviceTypeId"
                    render={({ field }) => (
                      <CatalogSelect
                        kind="servicos"
                        value={field.value}
                        onChange={(id) => field.onChange(id ?? '')}
                        currentItem={proposal?.serviceType}
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
                  <FieldLabel htmlFor="validUntil">Válida até</FieldLabel>
                  <Input id="validUntil" type="date" {...register('validUntil')} />
                </Field>

                <Field>
                  <FieldLabel required>Regime de cobrança</FieldLabel>
                  <Controller
                    control={control}
                    name="billingType"
                    render={({ field }) => (
                      <Select<BillingType>
                        items={BILLING_TYPE_LABELS}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger />
                        <SelectContent>
                          {(Object.keys(BILLING_TYPE_LABELS) as BillingType[]).map((b) => (
                            <SelectItem key={b} value={b}>
                              {translateBillingType(b)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                </Field>

                <Field data-invalid={!!errors.startOffsetDays}>
                  <FieldLabel htmlFor="startOffsetDays" required>
                    Começa em (dias após o aceite)
                  </FieldLabel>
                  <Input
                    id="startOffsetDays"
                    type="number"
                    min={0}
                    max={365}
                    {...register('startOffsetDays', {
                      setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                    })}
                  />
                  {errors.startOffsetDays && (
                    <FieldError>{errors.startOffsetDays.message}</FieldError>
                  )}
                </Field>

                {billingType === 'RECURRING' && (
                  <>
                    <Field data-invalid={!!errors.billingDay}>
                      <FieldLabel htmlFor="billingDay" required>
                        Dia de vencimento (1–28)
                      </FieldLabel>
                      <Input
                        id="billingDay"
                        type="number"
                        min={1}
                        max={28}
                        {...register('billingDay', {
                          setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                        })}
                      />
                      {errors.billingDay && <FieldError>{errors.billingDay.message}</FieldError>}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="durationMonths">Duração (meses)</FieldLabel>
                      <Input
                        id="durationMonths"
                        type="number"
                        min={1}
                        max={120}
                        placeholder="Em branco = indeterminado"
                        {...register('durationMonths', {
                          setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                        })}
                      />
                    </Field>
                  </>
                )}

                {billingType === 'INSTALLMENTS' && (
                  <>
                    <Field>
                      <FieldLabel required>Entrada</FieldLabel>
                      <Controller
                        control={control}
                        name="tipoDeEntrada"
                        render={({ field }) => (
                          <Select<Values['tipoDeEntrada']>
                            items={{ NENHUMA: 'Nenhuma', PERCENTUAL: 'Percentual', VALOR: 'Valor' }}
                            value={field.value}
                            onValueChange={field.onChange}
                          >
                            <SelectTrigger />
                            <SelectContent>
                              <SelectItem value="NENHUMA">Nenhuma</SelectItem>
                              <SelectItem value="PERCENTUAL">Percentual</SelectItem>
                              <SelectItem value="VALOR">Valor</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      />
                    </Field>

                    {tipoDeEntrada === 'PERCENTUAL' && (
                      <Field data-invalid={!!errors.downPaymentPercent}>
                        <FieldLabel htmlFor="downPaymentPercent" required>
                          Entrada (%)
                        </FieldLabel>
                        <Input
                          id="downPaymentPercent"
                          type="number"
                          min={0.01}
                          max={100}
                          step={0.01}
                          {...register('downPaymentPercent', {
                            setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                          })}
                        />
                        {errors.downPaymentPercent && (
                          <FieldError>{errors.downPaymentPercent.message}</FieldError>
                        )}
                      </Field>
                    )}

                    {tipoDeEntrada === 'VALOR' && (
                      <Field data-invalid={!!errors.downPaymentAmount}>
                        <FieldLabel htmlFor="downPaymentAmount" required>
                          Valor da entrada
                        </FieldLabel>
                        <Controller
                          control={control}
                          name="downPaymentAmount"
                          render={({ field }) => (
                            <MoneyInput
                              id="downPaymentAmount"
                              value={field.value}
                              onValueChange={field.onChange}
                            />
                          )}
                        />
                        {errors.downPaymentAmount && (
                          <FieldError>{errors.downPaymentAmount.message}</FieldError>
                        )}
                      </Field>
                    )}

                    {tipoDeEntrada !== 'NENHUMA' && (
                      <Field>
                        <FieldLabel htmlFor="downPaymentOffsetDays">
                          Vencimento da entrada (dias após o aceite)
                        </FieldLabel>
                        <Input
                          id="downPaymentOffsetDays"
                          type="number"
                          min={0}
                          max={365}
                          {...register('downPaymentOffsetDays', {
                            setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                          })}
                        />
                      </Field>
                    )}

                    <Field data-invalid={!!errors.installments}>
                      <FieldLabel htmlFor="installments" required>
                        Quantidade de parcelas
                      </FieldLabel>
                      <Input
                        id="installments"
                        type="number"
                        min={1}
                        max={120}
                        {...register('installments', {
                          setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                        })}
                      />
                      {errors.installments && (
                        <FieldError>{errors.installments.message}</FieldError>
                      )}
                    </Field>
                  </>
                )}

                <Field>
                  <FieldLabel htmlFor="paymentTerms">Condições de pagamento</FieldLabel>
                  <Input id="paymentTerms" placeholder="Ex.: 50% na aprovação, 50% na entrega" {...register('paymentTerms')} />
                  <FieldDescription>
                    Observação complementar em texto livre — o plano de cobrança acima é o que gera o contrato.
                  </FieldDescription>
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
