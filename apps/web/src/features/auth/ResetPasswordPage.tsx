import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AuthLayout } from './AuthLayout';

const schema = z
  .object({
    password: z.string().min(6, 'Mínimo 6 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não coincidem',
  });
type Values = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = async (v: Values) => {
    try {
      await api.post('/auth/reset-password', { token, password: v.password });
      toast.success('Senha redefinida com sucesso! Faça login com a nova senha.');
      navigate('/login', { replace: true });
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível redefinir a senha. Tente novamente.';
      toast.error(message);
    }
  };

  return (
    <AuthLayout
      title="Definir nova senha"
      description="Escolha uma nova senha para sua conta."
    >
      {token ? (
        <form onSubmit={handleSubmit(onSubmit)}>
          <FieldGroup>
            <Field data-invalid={!!errors.password}>
              <FieldLabel htmlFor="password" required>Nova senha</FieldLabel>
              <PasswordInput
                id="password"
                autoComplete="new-password"
                placeholder="Mínimo de 6 caracteres"
                aria-invalid={!!errors.password}
                {...register('password')}
              />
              {errors.password && <FieldError>{errors.password.message}</FieldError>}
            </Field>
            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirmPassword" required>Confirmar senha</FieldLabel>
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                placeholder="Repita a nova senha"
                aria-invalid={!!errors.confirmPassword}
                {...register('confirmPassword')}
              />
              {errors.confirmPassword && (
                <FieldError>{errors.confirmPassword.message}</FieldError>
              )}
            </Field>
            <Button type="submit" size="lg" disabled={isSubmitting}>
              {isSubmitting && <Spinner data-icon="inline-start" />}
              Redefinir senha
            </Button>
          </FieldGroup>
        </form>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground" role="alert">
            Link de redefinição inválido. Solicite um novo pela página "Esqueci
            minha senha".
          </p>
          <Link
            to="/esqueci-senha"
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            Solicitar novo link
          </Link>
        </div>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Lembrou a senha?{' '}
        <Link to="/login" className="font-medium text-primary hover:underline">
          Entrar
        </Link>
      </p>
    </AuthLayout>
  );
}
