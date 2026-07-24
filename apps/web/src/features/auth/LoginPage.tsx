import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { clearCredentials, loadCredentials, saveCredentials } from '@/lib/remember';
import { OAuthButtons } from './OAuthButtons';

const OAUTH_ERRORS: Record<string, string> = {
  oauth: 'Não foi possível entrar com o provedor. Tente novamente.',
  oauth_indisponivel: 'Este provedor de login não está disponível no momento.',
};

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});
type Values = z.infer<typeof schema>;

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [remember, setRemember] = useState(false);

  useEffect(() => {
    const error = searchParams.get('error');
    if (error) {
      toast.error(OAUTH_ERRORS[error] ?? OAUTH_ERRORS.oauth);
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  useEffect(() => {
    loadCredentials().then((creds) => {
      if (creds) {
        reset(creds);
        setRemember(true);
      }
    });
  }, [reset]);

  const onSubmit = async (v: Values) => {
    try {
      await login(v.email, v.password);
      if (remember) await saveCredentials(v.email, v.password);
      else clearCredentials();
      navigate('/', { replace: true });
    } catch {
      toast.error('Credenciais inválidas');
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Entrar no CRM ProgrameAi</CardTitle>
          <CardDescription>Acesse com seu e-mail e senha.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.email}>
                <FieldLabel htmlFor="email" required>E-mail</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  aria-invalid={!!errors.email}
                  {...register('email')}
                />
                {errors.email && <FieldError>{errors.email.message}</FieldError>}
              </Field>
              <Field data-invalid={!!errors.password}>
                <FieldLabel htmlFor="password" required>Senha</FieldLabel>
                <PasswordInput
                  id="password"
                  autoComplete="current-password"
                  aria-invalid={!!errors.password}
                  {...register('password')}
                />
                {errors.password && <FieldError>{errors.password.message}</FieldError>}
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="remember"
                  checked={remember}
                  onCheckedChange={(checked) => setRemember(checked === true)}
                />
                <FieldLabel htmlFor="remember" className="font-normal">
                  Lembrar de mim
                </FieldLabel>
              </Field>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Entrar
              </Button>
            </FieldGroup>
          </form>
          <OAuthButtons />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Não tem uma conta?{' '}
            <Link to="/registrar" className="font-medium text-primary hover:underline">
              Criar conta
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
