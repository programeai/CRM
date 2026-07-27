import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useMe, useUpdateProfile } from './api/hooks';
import { SessoesAtivas } from './SessoesAtivas';
import { PreferenciasDeNotificacao } from '@/features/notificacoes/PreferenciasDeNotificacao';

const schema = z.object({
  name: z
    .string()
    .min(2, 'O nome deve ter no mínimo 2 caracteres')
    .max(120, 'O nome deve ter no máximo 120 caracteres'),
  email: z.string().email('E-mail inválido'),
});
type Values = z.infer<typeof schema>;

interface PerfilDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PerfilDialog({ open, onOpenChange }: PerfilDialogProps) {
  const { data: me, isPending } = useMe();
  const updateProfile = useUpdateProfile();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '' },
  });

  // Preenche o formulário assim que os dados do usuário chegam ou ao reabrir.
  useEffect(() => {
    if (open && me) reset({ name: me.name, email: me.email });
  }, [open, me, reset]);

  const onSubmit = async (v: Values) => {
    try {
      const updated = await updateProfile.mutateAsync(v);
      reset({ name: updated.name, email: updated.email });
      toast.success('Perfil atualizado com sucesso!');
      onOpenChange(false);
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível salvar as alterações. Tente novamente.';
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Perfil</DialogTitle>
          <DialogDescription>
            Atualize seu nome e e-mail de acesso e veja os dispositivos com
            acesso à sua conta.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Carregando…
            </div>
          ) : (
            <form
              id="perfil-form"
              className="flex flex-col gap-4"
              onSubmit={handleSubmit(onSubmit)}
            >
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name" required>
                  Nome
                </FieldLabel>
                <Input
                  id="name"
                  autoComplete="name"
                  placeholder="Seu nome"
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                {errors.name && <FieldError>{errors.name.message}</FieldError>}
              </Field>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email" required>
                  E-mail
                </FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  placeholder="voce@agencia.com.br"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
                {errors.email && <FieldError>{errors.email.message}</FieldError>}
              </Field>
            </form>
          )}

          <SessoesAtivas enabled={open} />
          <PreferenciasDeNotificacao enabled={open} />
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
            form="perfil-form"
            disabled={isPending || isSubmitting || !isDirty}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isSubmitting ? 'Salvando…' : 'Salvar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
