import { Controller, useFieldArray, useWatch, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/ui/money-input';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { formatMoney } from '../lib/proposal-format';
import type { ProposalFormValues } from '../ProposalFormDialog';

type Values = ProposalFormValues;

interface Props {
  control: Control<Values>;
  register: UseFormRegister<Values>;
  errors: FieldErrors<Values>;
}

/** Converte reais para centavos inteiros (espelha `computeTotal` do backend). */
function toCents(v: number): number {
  return Math.round((v || 0) * 100);
}

/** Total ao vivo em centavos: Σ round(qty×unit) − desconto, nunca negativo. */
function liveTotalCents(items: { quantity: number; unitPrice: number }[], discount = 0): number {
  const gross = items.reduce((s, it) => s + toCents((it.quantity || 0) * (it.unitPrice || 0)), 0);
  return Math.max(0, gross - toCents(discount));
}

/** Editor de linhas dinâmicas de item (descrição/qtd/valor) com total ao vivo. */
export function ItemsEditor({ control, register, errors }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const items = useWatch({ control, name: 'items' }) ?? [];
  const discount = useWatch({ control, name: 'discount' }) ?? 0;
  const total = liveTotalCents(items, discount) / 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <FieldLabel required>Itens</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}
        >
          <Plus data-icon="inline-start" />
          Adicionar item
        </Button>
      </div>

      {errors.items?.root && <FieldError>{errors.items.root.message}</FieldError>}
      {errors.items && !Array.isArray(errors.items) && !errors.items.root && (
        <FieldError>{errors.items.message as string}</FieldError>
      )}

      <div className="flex flex-col gap-2">
        {fields.map((field, index) => {
          const rowItem = items[index] ?? { quantity: 0, unitPrice: 0 };
          const subtotal = toCents((rowItem.quantity || 0) * (rowItem.unitPrice || 0)) / 100;
          const itemErrors = Array.isArray(errors.items) ? errors.items[index] : undefined;
          return (
            <div
              key={field.id}
              className="grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_5rem_8rem_7rem_auto] sm:items-start"
            >
              <Field data-invalid={!!itemErrors?.description}>
                <FieldLabel htmlFor={`items.${index}.description`} className="sm:hidden">
                  Descrição
                </FieldLabel>
                <Input
                  id={`items.${index}.description`}
                  placeholder="Descrição"
                  aria-invalid={!!itemErrors?.description}
                  {...register(`items.${index}.description` as const)}
                />
                {itemErrors?.description && (
                  <FieldError>{itemErrors.description.message}</FieldError>
                )}
              </Field>

              <Field data-invalid={!!itemErrors?.quantity}>
                <FieldLabel htmlFor={`items.${index}.quantity`} className="sm:hidden">
                  Qtd.
                </FieldLabel>
                <Input
                  id={`items.${index}.quantity`}
                  type="number"
                  min={0}
                  step="0.01"
                  aria-invalid={!!itemErrors?.quantity}
                  {...register(`items.${index}.quantity` as const, { valueAsNumber: true })}
                />
              </Field>

              <Field data-invalid={!!itemErrors?.unitPrice}>
                <FieldLabel htmlFor={`items.${index}.unitPrice`} className="sm:hidden">
                  Valor unitário
                </FieldLabel>
                <Controller
                  control={control}
                  name={`items.${index}.unitPrice` as const}
                  render={({ field: unitPriceField }) => (
                    <MoneyInput
                      id={`items.${index}.unitPrice`}
                      value={unitPriceField.value ?? 0}
                      onValueChange={unitPriceField.onChange}
                    />
                  )}
                />
              </Field>

              <div className="flex flex-col gap-1.5 pt-2 text-sm tabular-nums whitespace-nowrap sm:h-9 sm:items-center sm:justify-center sm:pt-0">
                <span className="text-xs text-muted-foreground sm:hidden">Subtotal</span>
                {formatMoney(subtotal)}
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={fields.length <= 1}
                onClick={() => remove(index)}
                aria-label="Remover item"
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>

      <div className="flex flex-col items-end gap-2 border-t pt-3">
        <div className="flex w-full max-w-xs items-center justify-between gap-4 sm:max-w-56">
          <FieldLabel htmlFor="discount">Desconto</FieldLabel>
          <Controller
            control={control}
            name="discount"
            render={({ field }) => (
              <MoneyInput
                id="discount"
                value={field.value ?? 0}
                onValueChange={field.onChange}
              />
            )}
          />
        </div>
        <div className="flex items-center gap-2 text-base font-semibold">
          Total: <span className="tabular-nums">{formatMoney(total)}</span>
        </div>
      </div>
    </div>
  );
}
