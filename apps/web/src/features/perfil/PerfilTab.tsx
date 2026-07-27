import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { extractApiMessage } from '@/lib/api-error';
import { useMe, useUpdateProfile } from './api/hooks';

const schema = z.object({
  name: z
    .string()
    .min(2, 'O nome deve ter no mínimo 2 caracteres')
    .max(120, 'O nome deve ter no máximo 120 caracteres'),
  email: z.string().email('E-mail inválido'),
});
type Values = z.infer<typeof schema>;

/** Aba inicial de `/configuracoes`: nome e e-mail de acesso. */
export default function PerfilTab() {
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

  // Preenche o formulário assim que os dados do usuário chegam.
  useEffect(() => {
    if (me) reset({ name: me.name, email: me.email });
  }, [me, reset]);

  const onSubmit = async (v: Values) => {
    try {
      const updated = await updateProfile.mutateAsync(v);
      // O `reset` com o que voltou zera o `isDirty` — o botão desabilita de
      // novo até a próxima edição.
      reset({ name: updated.name, email: updated.email });
      toast.success('Perfil atualizado com sucesso!');
    } catch (err) {
      toast.error(
        extractApiMessage(
          err,
          'Não foi possível salvar as alterações. Tente novamente.',
        ),
      );
    }
  };

  return (
    <section className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-heading text-lg font-semibold">Perfil</h2>
        <p className="text-sm text-muted-foreground">
          Seu nome aparece para o time nas atribuições. O e-mail é o que você
          usa para entrar.
        </p>
      </div>

      {isPending ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : (
        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
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
          <div className="flex justify-end">
            <Button type="submit" disabled={isSubmitting || !isDirty}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              {isSubmitting ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
