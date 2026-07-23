import { Controller, useFieldArray, type Control, type FieldErrors, type UseFormRegister } from 'react-hook-form';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import type { TaskFormValues } from '../TaskFormDialog';

type Values = TaskFormValues;

interface Props {
  control: Control<Values>;
  register: UseFormRegister<Values>;
  errors: FieldErrors<Values>;
}

/** Editor de checklist (subtarefas) do formulário de tarefa — modelo de `ItemsEditor` de propostas. */
export function ChecklistEditor({ control, register, errors }: Props) {
  const { fields, append, remove } = useFieldArray({ control, name: 'checklist' });

  return (
    <div className="flex flex-col gap-3 sm:col-span-2">
      <div className="flex items-center justify-between">
        <FieldLabel>Checklist</FieldLabel>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append({ text: '', done: false })}
        >
          <Plus data-icon="inline-start" />
          Adicionar item
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        {fields.map((field, index) => {
          const itemErrors = Array.isArray(errors.checklist) ? errors.checklist[index] : undefined;
          return (
            <div key={field.id} className="flex items-start gap-2">
              <Controller
                control={control}
                name={`checklist.${index}.done` as const}
                render={({ field: doneField }) => (
                  <Checkbox
                    className="mt-2.5"
                    checked={doneField.value}
                    onCheckedChange={(checked) => doneField.onChange(!!checked)}
                  />
                )}
              />
              <Field className="flex-1" data-invalid={!!itemErrors?.text}>
                <Input
                  placeholder="Item do checklist"
                  aria-invalid={!!itemErrors?.text}
                  {...register(`checklist.${index}.text` as const)}
                />
                {itemErrors?.text && <FieldError>{itemErrors.text.message}</FieldError>}
              </Field>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => remove(index)}
                aria-label="Remover item"
              >
                <Trash2 />
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
