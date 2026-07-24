import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link } from 'react-router';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';

const schema = z.object({
  email: z.string().email('E-mail inválido'),
});
type Values = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  });

  const onSubmit = async (v: Values) => {
    // Resposta genérica no back-end (anti-enumeração): sempre tratamos como sucesso.
    await api.post('/auth/forgot-password', { email: v.email }).catch(() => {});
    setSent(true);
  };

  return (
    <AuthLayout
      title="Esqueceu a senha?"
      description="Informe seu e-mail e enviaremos um link para redefinir."
    >
      {sent ? (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Se existir uma conta com este e-mail, enviamos as instruções para
            redefinir a senha. Verifique também a caixa de spam. O link é válido
            por 1 hora.
          </p>
          <Link to="/login" className={cn(buttonVariants({ size: 'lg' }), 'w-full')}>
            Voltar para o login
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email" required>E-mail</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="voce@agencia.com.br"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
                {errors.email && <FieldError>{errors.email.message}</FieldError>}
              </Field>
              <Button type="submit" size="lg" disabled={isSubmitting}>
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Enviar link de redefinição
              </Button>
            </FieldGroup>
          </form>
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Lembrou a senha?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </>
      )}
    </AuthLayout>
  );
}
