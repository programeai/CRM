import { useEffect, useMemo } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
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
import { Select, SelectContent, SelectItem, SelectTrigger } from '@/components/ui/select';
import { PAYMENT_METHOD_LABELS, translatePaymentMethod } from '@/lib/labels';
import { extractApiMessage } from '../lib/api-error';
import { usePayPayment } from '../api/hooks';
import type { Payment, PaymentMethod } from '../api/types';

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function makeSchema(originalAmount: number) {
  return z
    .object({
      method: z.enum(['PIX', 'TRANSFER', 'BOLETO', 'CARD', 'CASH']),
      paidAt: z.string().min(1, 'Data do pagamento obrigatória.'),
      paidAmount: z.number().min(0, 'Valor recebido inválido.'),
      notes: z.string().optional(),
    })
    .superRefine((v, ctx) => {
      if (Math.abs(v.paidAmount - originalAmount) > 0.001 && !v.notes?.trim()) {
        ctx.addIssue({
          code: 'custom',
          path: ['notes'],
          message: 'Valor diferente do previsto exige observação.',
        });
      }
    });
}
type Values = z.infer<ReturnType<typeof makeSchema>>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment;
}

/** Dá baixa numa cobrança (PENDING/OVERDUE → PAID). Valor diferente do previsto exige observação. */
export function BaixaDialog({ open, onOpenChange, payment }: Props) {
  const amount = Number(payment.amount);
  const schema = useMemo(() => makeSchema(amount), [amount]);
  const pay = usePayPayment(payment.id);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { method: 'PIX', paidAt: todayIso(), paidAmount: amount, notes: '' },
  });

  useEffect(() => {
    if (!open) return;
    reset({ method: 'PIX', paidAt: todayIso(), paidAmount: amount, notes: '' });
  }, [open, amount, reset]);

  const onSubmit = async (v: Values) => {
    try {
      await pay.mutateAsync({
        method: v.method,
        paidAt: v.paidAt,
        paidAmount: v.paidAmount,
        notes: v.notes || undefined,
      });
      toast.success('Baixa registrada.');
      onOpenChange(false);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao dar baixa na cobrança.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dar baixa</DialogTitle>
          <DialogDescription>{payment.description}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            onSubmit={handleSubmit(onSubmit)}
            id="baixa-form"
          >
            <Field>
              <FieldLabel required>Forma de pagamento</FieldLabel>
              <Controller
                control={control}
                name="method"
                render={({ field }) => (
                  <Select<PaymentMethod> items={PAYMENT_METHOD_LABELS} value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger />
                    <SelectContent>
                      {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                        <SelectItem key={m} value={m}>
                          {translatePaymentMethod(m)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>

            <Field data-invalid={!!errors.paidAt}>
              <FieldLabel htmlFor="paidAt" required>
                Data do pagamento
              </FieldLabel>
              <Input id="paidAt" type="date" {...register('paidAt')} />
              {errors.paidAt && <FieldError>{errors.paidAt.message}</FieldError>}
            </Field>

            <Field className="sm:col-span-2" data-invalid={!!errors.paidAmount}>
              <FieldLabel htmlFor="paidAmount" required>
                Valor recebido
              </FieldLabel>
              <Controller
                control={control}
                name="paidAmount"
                render={({ field }) => (
                  <MoneyInput id="paidAmount" value={field.value} onValueChange={field.onChange} />
                )}
              />
              {errors.paidAmount && <FieldError>{errors.paidAmount.message}</FieldError>}
            </Field>

            <Field className="sm:col-span-2" data-invalid={!!errors.notes}>
              <FieldLabel htmlFor="notes">Observações</FieldLabel>
              <textarea
                id="notes"
                rows={3}
                placeholder="Observações sobre o pagamento…"
                className="min-h-20 w-full rounded-lg border border-input bg-transparent dark:bg-input/30 px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                {...register('notes')}
              />
              {errors.notes && <FieldError>{errors.notes.message}</FieldError>}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="baixa-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Confirmar baixa
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
