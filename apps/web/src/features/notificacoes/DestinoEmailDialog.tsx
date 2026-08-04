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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { extractApiMessage } from '@/lib/api-error';
import { useCriarDestino } from './api/hooks';
import { ListaDeEventos } from './ListaDeEventos';
import { NOTIFICATION_TYPES } from '@/lib/labels';
import { alternarTipo } from './tipos';

const schema = z.object({
  label: z.string().min(1, 'O rótulo é obrigatório.'),
  email: z.string().email('E-mail inválido.'),
  types: z.array(z.enum(NOTIFICATION_TYPES)).min(1, 'Selecione ao menos um evento.'),
});
type Values = z.infer<typeof schema>;

/**
 * Nasce com os seis marcados: é o mesmo padrão que a API aplica quando o corpo
 * não manda `types` (`TIPOS_PADRAO`). Quem quiser menos, desmarca aqui.
 */
const VAZIO: Values = { label: '', email: '', types: [...NOTIFICATION_TYPES] };

/** Cadastra um destino de e-mail. Nasce verificado: o endereço é do próprio usuário. */
export function DestinoEmailDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const criar = useCriarDestino();

  const {
    register,
    handleSubmit,
    control,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: VAZIO });

  // Reabrir o diálogo tem de começar limpo, sem o que ficou da vez anterior.
  useEffect(() => {
    if (open) reset(VAZIO);
  }, [open, reset]);

  const onSubmit = async (v: Values) => {
    try {
      await criar.mutateAsync({
        label: v.label.trim(),
        email: v.email.trim(),
        types: v.types,
      });
      toast.success('Destino criado.');
      onOpenChange(false);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao criar o destino.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Novo destino de e-mail</DialogTitle>
          <DialogDescription>
            Escolha para qual endereço enviar os avisos e quais eventos saem por
            ele — dá para mudar depois, no cartão do destino.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <form onSubmit={handleSubmit(onSubmit)} id="destino-email-form">
            <FieldGroup>
              <Field data-invalid={!!errors.label}>
                <FieldLabel htmlFor="destino-label" required>
                  Rótulo
                </FieldLabel>
                <Input
                  id="destino-label"
                  placeholder="Meu e-mail pessoal"
                  aria-invalid={!!errors.label}
                  {...register('label')}
                />
                {errors.label && (
                  <FieldError>{errors.label.message}</FieldError>
                )}
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="destino-email" required>
                  E-mail
                </FieldLabel>
                <Input
                  id="destino-email"
                  type="email"
                  placeholder="voce@exemplo.com.br"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
                {errors.email && (
                  <FieldError>{errors.email.message}</FieldError>
                )}
              </Field>
              <Controller
                control={control}
                name="types"
                render={({ field }) => (
                  <ListaDeEventos
                    selecionados={field.value}
                    onAlternar={(tipo) =>
                      field.onChange(alternarTipo(field.value, tipo))
                    }
                    erro={errors.types?.message}
                  />
                )}
              />
            </FieldGroup>
          </form>
        </DialogBody>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            form="destino-email-form"
            disabled={isSubmitting}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Criar destino
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
