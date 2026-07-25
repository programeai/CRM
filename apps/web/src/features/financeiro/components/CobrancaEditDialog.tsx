import { useEffect } from 'react';
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
import { extractApiMessage } from '../lib/api-error';
import { useUpdatePayment } from '../api/hooks';
import type { Payment } from '../api/types';

const schema = z.object({
  description: z.string().min(1, 'Descrição obrigatória.'),
  amount: z.number().min(0.01, 'Valor inválido.'),
  dueDate: z.string().min(1, 'Data de vencimento inválida.'),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: Payment;
}

/** Edita uma cobrança PENDING (descrição, valor, vencimento). */
export function CobrancaEditDialog({ open, onOpenChange, payment }: Props) {
  const updatePayment = useUpdatePayment(payment.id);

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      description: payment.description,
      amount: Number(payment.amount),
      dueDate: payment.dueDate.slice(0, 10),
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      description: payment.description,
      amount: Number(payment.amount),
      dueDate: payment.dueDate.slice(0, 10),
    });
  }, [open, payment, reset]);

  const onSubmit = async (v: Values) => {
    try {
      await updatePayment.mutateAsync(v);
      toast.success('Cobrança atualizada.');
      onOpenChange(false);
    } catch (error) {
      toast.error(extractApiMessage(error, 'Falha ao atualizar a cobrança.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar cobrança</DialogTitle>
          <DialogDescription>Só é possível editar cobranças pendentes.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form
            className="flex flex-col gap-4"
            onSubmit={handleSubmit(onSubmit)}
            id="cobranca-edit-form"
          >
            <Field data-invalid={!!errors.description}>
              <FieldLabel htmlFor="description" required>
                Descrição
              </FieldLabel>
              <Input id="description" placeholder="Ex.: Mensalidade de julho" aria-invalid={!!errors.description} {...register('description')} />
              {errors.description && <FieldError>{errors.description.message}</FieldError>}
            </Field>

            <Field data-invalid={!!errors.amount}>
              <FieldLabel htmlFor="amount" required>
                Valor
              </FieldLabel>
              <Controller
                control={control}
                name="amount"
                render={({ field }) => (
                  <MoneyInput id="amount" value={field.value} onValueChange={field.onChange} />
                )}
              />
              {errors.amount && <FieldError>{errors.amount.message}</FieldError>}
            </Field>

            <Field data-invalid={!!errors.dueDate}>
              <FieldLabel htmlFor="dueDate" required>
                Vencimento
              </FieldLabel>
              <Input id="dueDate" type="date" {...register('dueDate')} />
              {errors.dueDate && <FieldError>{errors.dueDate.message}</FieldError>}
            </Field>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="cobranca-edit-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
