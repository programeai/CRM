import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useMe, useUpdateProfile } from './api/hooks';

const schema = z.object({
  name: z
    .string()
    .min(2, 'O nome deve ter no mínimo 2 caracteres')
    .max(120, 'O nome deve ter no máximo 120 caracteres'),
  email: z.string().email('E-mail inválido'),
});
type Values = z.infer<typeof schema>;

export default function PerfilPage() {
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
      reset({ name: updated.name, email: updated.email });
      toast.success('Perfil atualizado com sucesso!');
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível salvar as alterações. Tente novamente.';
      toast.error(message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">Perfil</h1>

      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>Dados cadastrais</CardTitle>
          <CardDescription>
            Atualize seu nome e e-mail de acesso.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Carregando…
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)}>
              <FieldGroup>
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="name" required>
                    Nome
                  </FieldLabel>
                  <Input
                    id="name"
                    autoComplete="name"
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
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && (
                    <FieldError>{errors.email.message}</FieldError>
                  )}
                </Field>
                <Button type="submit" disabled={isSubmitting || !isDirty}>
                  {isSubmitting && <Spinner data-icon="inline-start" />}
                  {isSubmitting ? 'Salvando…' : 'Salvar'}
                </Button>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
