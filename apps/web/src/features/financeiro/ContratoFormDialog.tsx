import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { MoneyInput } from '@/components/ui/money-input';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
} from '@/components/ui/select';
import { BILLING_TYPE_LABELS, translateBillingType } from '@/lib/labels';
import { useDebouncedValue } from '@/hooks/use-debounced-value';
import { ClientFormDialog } from '@/features/clientes/ClientFormDialog';
import type { Client } from '@/features/clientes/api/types';
import { extractApiMessage } from './lib/api-error';
import { useClientOptions, useCreateContract, useUpdateContract } from './api/hooks';
import type { BillingType, Contract, CreateContractBody } from './api/types';

const schema = z
  .object({
    clientId: z.string().uuid('Selecione um cliente.'),
    description: z.string().min(1, 'Descrição obrigatória.'),
    billingType: z.enum(['RECURRING', 'INSTALLMENTS', 'ONE_TIME']),
    // RECURRING
    monthlyAmount: z.number().optional(),
    billingDay: z.number().optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    // INSTALLMENTS
    downPayment: z.number().optional(),
    downPaymentDueDate: z.string().optional(),
    installments: z.number().optional(),
    installmentAmount: z.number().optional(),
    firstInstallmentDueDate: z.string().optional(),
    // ONE_TIME
    amount: z.number().optional(),
    dueDate: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.billingType === 'RECURRING') {
      if (!v.monthlyAmount || v.monthlyAmount <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['monthlyAmount'],
          message: 'Valor mensal inválido.',
        });
      }
      if (!v.billingDay || v.billingDay < 1 || v.billingDay > 28) {
        ctx.addIssue({
          code: 'custom',
          path: ['billingDay'],
          message: 'Dia de vencimento entre 1 e 28.',
        });
      }
      if (!v.startDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['startDate'],
          message: 'Data de início inválida.',
        });
      }
    }
    if (v.billingType === 'INSTALLMENTS') {
      if (!v.installments || v.installments < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['installments'],
          message: 'Informe a quantidade de parcelas.',
        });
      }
      if (!v.installmentAmount || v.installmentAmount <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['installmentAmount'],
          message: 'Valor da parcela inválido.',
        });
      }
      if (!v.firstInstallmentDueDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['firstInstallmentDueDate'],
          message: 'Vencimento da 1ª parcela inválido.',
        });
      }
    }
    if (v.billingType === 'ONE_TIME') {
      if (!v.amount || v.amount <= 0) {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Valor inválido.' });
      }
      if (!v.dueDate) {
        ctx.addIssue({
          code: 'custom',
          path: ['dueDate'],
          message: 'Data de vencimento inválida.',
        });
      }
    }
  });
type Values = z.infer<typeof schema>;

const EMPTY: Values = {
  clientId: '',
  description: '',
  billingType: 'RECURRING',
};

function toValues(contract: Contract): Values {
  return {
    clientId: contract.clientId,
    description: contract.description,
    billingType: contract.billingType,
    monthlyAmount: contract.monthlyAmount != null ? Number(contract.monthlyAmount) : undefined,
    billingDay: contract.billingDay ?? undefined,
    startDate: contract.startDate?.slice(0, 10),
    endDate: contract.endDate?.slice(0, 10),
  };
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contract?: Contract;
  defaultClientId?: string;
  defaultDescription?: string;
  defaultProposalId?: string;
  suggestedAmount?: number;
}

/**
 * Cria/edita contratos (RHF+Zod) com campos condicionais por `billingType`.
 * Em edição, o regime e os campos já materializados em cobranças são imutáveis
 * (só descrição/valor mensal/dia de vencimento/término, ver UpdateContractDto).
 */
export function ContratoFormDialog({
  open,
  onOpenChange,
  contract,
  defaultClientId,
  defaultDescription,
  defaultProposalId,
  suggestedAmount,
}: Props) {
  const isEdit = !!contract;
  const createContract = useCreateContract();
  const updateContract = useUpdateContract(contract?.id ?? '');

  const [clientSearch, setClientSearch] = useState('');
  const debounced = useDebouncedValue(clientSearch, 300);
  const { data: clientOptions } = useClientOptions(debounced);

  const [selectOpen, setSelectOpen] = useState(false);
  const [clientFormOpen, setClientFormOpen] = useState(false);
  const [createdClients, setCreatedClients] = useState<{ id: string; name: string }[]>([]);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY,
  });

  const billingType = watch('billingType');
  const installments = watch('installments');
  const installmentAmount = watch('installmentAmount');
  const downPayment = watch('downPayment');

  useEffect(() => {
    if (!open) return;
    setCreatedClients([]);
    reset(
      contract
        ? toValues(contract)
        : {
            ...EMPTY,
            clientId: defaultClientId ?? '',
            description: defaultDescription ?? '',
          },
    );
  }, [open, contract, defaultClientId, defaultDescription, reset]);

  // Conveniência de UI: sugere o valor da parcela a partir do total da proposta.
  useEffect(() => {
    if (!open || isEdit || !suggestedAmount || billingType !== 'INSTALLMENTS') return;
    if (installmentAmount) return; // usuário já editou; não sobrescreve
    const n = installments && installments > 0 ? installments : 1;
    const remaining = Math.max(0, suggestedAmount - (downPayment ?? 0));
    setValue('installmentAmount', Math.round((remaining / n) * 100) / 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, isEdit, suggestedAmount, billingType, installments, downPayment]);

  const clientChoices = [
    ...createdClients,
    ...(clientOptions ?? []).filter((c) => !createdClients.some((n) => n.id === c.id)),
  ];

  const handleClientCreated = (client: Client) => {
    setCreatedClients((prev) =>
      prev.some((c) => c.id === client.id) ? prev : [{ id: client.id, name: client.name }, ...prev],
    );
    setValue('clientId', client.id, { shouldValidate: true });
  };

  const onSubmit = async (v: Values) => {
    try {
      if (isEdit) {
        await updateContract.mutateAsync({
          description: v.description,
          ...(v.billingType === 'RECURRING'
            ? { monthlyAmount: v.monthlyAmount, billingDay: v.billingDay }
            : {}),
          endDate: v.endDate || undefined,
        });
        toast.success('Contrato atualizado.');
      } else {
        const body: CreateContractBody = {
          clientId: v.clientId,
          description: v.description,
          billingType: v.billingType,
          proposalId: defaultProposalId,
          ...(v.billingType === 'RECURRING'
            ? {
                monthlyAmount: v.monthlyAmount,
                billingDay: v.billingDay,
                startDate: v.startDate,
                endDate: v.endDate || undefined,
              }
            : {}),
          ...(v.billingType === 'INSTALLMENTS'
            ? {
                downPayment: v.downPayment || undefined,
                downPaymentDueDate: v.downPaymentDueDate || undefined,
                installments: v.installments,
                installmentAmount: v.installmentAmount,
                firstInstallmentDueDate: v.firstInstallmentDueDate,
              }
            : {}),
          ...(v.billingType === 'ONE_TIME'
            ? { amount: v.amount, dueDate: v.dueDate }
            : {}),
        };
        await createContract.mutateAsync(body);
        toast.success('Contrato criado.');
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        extractApiMessage(
          error,
          isEdit ? 'Falha ao atualizar o contrato.' : 'Falha ao criar o contrato.',
        ),
      );
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Editar contrato' : 'Novo contrato'}</DialogTitle>
            <DialogDescription>Dados do contrato e regime de cobrança.</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              onSubmit={handleSubmit(onSubmit)}
              id="contract-form"
            >
              {!defaultClientId && !isEdit && (
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

              <Field className="sm:col-span-2" data-invalid={!!errors.description}>
                <FieldLabel htmlFor="description" required>
                  Descrição
                </FieldLabel>
                <Input
                  id="description"
                  aria-invalid={!!errors.description}
                  {...register('description')}
                />
                {errors.description && <FieldError>{errors.description.message}</FieldError>}
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
                      disabled={isEdit}
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

              {billingType === 'RECURRING' && (
                <>
                  <Field data-invalid={!!errors.monthlyAmount}>
                    <FieldLabel htmlFor="monthlyAmount" required>
                      Valor mensal
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="monthlyAmount"
                      render={({ field }) => (
                        <MoneyInput
                          id="monthlyAmount"
                          value={field.value}
                          onValueChange={field.onChange}
                        />
                      )}
                    />
                    {errors.monthlyAmount && (
                      <FieldError>{errors.monthlyAmount.message}</FieldError>
                    )}
                  </Field>

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

                  <Field data-invalid={!!errors.startDate}>
                    <FieldLabel htmlFor="startDate" required>
                      Início
                    </FieldLabel>
                    <Input
                      id="startDate"
                      type="date"
                      disabled={isEdit}
                      {...register('startDate')}
                    />
                    {errors.startDate && <FieldError>{errors.startDate.message}</FieldError>}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="endDate">Término</FieldLabel>
                    <Input id="endDate" type="date" {...register('endDate')} />
                  </Field>
                </>
              )}

              {billingType === 'INSTALLMENTS' && (
                <>
                  <Field>
                    <FieldLabel htmlFor="downPayment">Entrada</FieldLabel>
                    <Controller
                      control={control}
                      name="downPayment"
                      render={({ field }) => (
                        <MoneyInput
                          id="downPayment"
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isEdit}
                        />
                      )}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="downPaymentDueDate">Vencimento da entrada</FieldLabel>
                    <Input
                      id="downPaymentDueDate"
                      type="date"
                      disabled={isEdit}
                      {...register('downPaymentDueDate')}
                    />
                  </Field>

                  <Field data-invalid={!!errors.installments}>
                    <FieldLabel htmlFor="installments" required>
                      Quantidade de parcelas
                    </FieldLabel>
                    <Input
                      id="installments"
                      type="number"
                      min={1}
                      disabled={isEdit}
                      {...register('installments', {
                        setValueAs: (v) => (v === '' || v == null ? undefined : Number(v)),
                      })}
                    />
                    {errors.installments && (
                      <FieldError>{errors.installments.message}</FieldError>
                    )}
                  </Field>

                  <Field data-invalid={!!errors.installmentAmount}>
                    <FieldLabel htmlFor="installmentAmount" required>
                      Valor da parcela
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="installmentAmount"
                      render={({ field }) => (
                        <MoneyInput
                          id="installmentAmount"
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isEdit}
                        />
                      )}
                    />
                    {errors.installmentAmount && (
                      <FieldError>{errors.installmentAmount.message}</FieldError>
                    )}
                  </Field>

                  <Field data-invalid={!!errors.firstInstallmentDueDate}>
                    <FieldLabel htmlFor="firstInstallmentDueDate" required>
                      Vencimento da 1ª parcela
                    </FieldLabel>
                    <Input
                      id="firstInstallmentDueDate"
                      type="date"
                      disabled={isEdit}
                      {...register('firstInstallmentDueDate')}
                    />
                    {errors.firstInstallmentDueDate && (
                      <FieldError>{errors.firstInstallmentDueDate.message}</FieldError>
                    )}
                  </Field>
                </>
              )}

              {billingType === 'ONE_TIME' && (
                <>
                  <Field data-invalid={!!errors.amount}>
                    <FieldLabel htmlFor="amount" required>
                      Valor
                    </FieldLabel>
                    <Controller
                      control={control}
                      name="amount"
                      render={({ field }) => (
                        <MoneyInput
                          id="amount"
                          value={field.value}
                          onValueChange={field.onChange}
                          disabled={isEdit}
                        />
                      )}
                    />
                    {errors.amount && <FieldError>{errors.amount.message}</FieldError>}
                  </Field>

                  <Field data-invalid={!!errors.dueDate}>
                    <FieldLabel htmlFor="dueDate" required>
                      Vencimento
                    </FieldLabel>
                    <Input
                      id="dueDate"
                      type="date"
                      disabled={isEdit}
                      {...register('dueDate')}
                    />
                    {errors.dueDate && <FieldError>{errors.dueDate.message}</FieldError>}
                  </Field>
                </>
              )}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" form="contract-form" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {isEdit ? 'Salvar' : 'Criar contrato'}
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
