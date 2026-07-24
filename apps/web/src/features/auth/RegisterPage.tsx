import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { OAuthButtons } from './OAuthButtons';
import { Turnstile } from './Turnstile';

const CAPTCHA_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as
  | string
  | undefined;

const schema = z
  .object({
    name: z
      .string()
      .min(2, 'O nome deve ter no mínimo 2 caracteres')
      .max(120, 'O nome deve ter no máximo 120 caracteres'),
    email: z.string().email('E-mail inválido'),
    password: z.string().min(6, 'Mínimo 6 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'As senhas não coincidem',
  });
type Values = z.infer<typeof schema>;

export default function RegisterPage() {
  const { register: registerUser } = useAuth();
  const navigate = useNavigate();
  const captchaEnabled = Boolean(CAPTCHA_SITE_KEY);
  const [captchaToken, setCaptchaToken] = useState('');
  // Bump para remontar o widget (tokens do Turnstile são de uso único).
  const [captchaKey, setCaptchaKey] = useState(0);
  const resetCaptcha = () => {
    setCaptchaToken('');
    setCaptchaKey((k) => k + 1);
  };
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '', confirmPassword: '' },
  });

  const onSubmit = async (v: Values) => {
    if (captchaEnabled && !captchaToken) {
      toast.error('Confirme que você não é um robô.');
      return;
    }
    try {
      await registerUser(v.name, v.email, v.password, captchaToken || undefined);
      toast.success('Conta criada com sucesso!');
      navigate('/', { replace: true });
    } catch (err) {
      if (captchaEnabled) resetCaptcha();
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível criar a conta. Tente novamente.';
      toast.error(message);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Criar conta no CRM ProgrameAi</CardTitle>
          <CardDescription>Preencha seus dados para começar.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)}>
            <FieldGroup>
              <Field data-invalid={!!errors.name}>
                <FieldLabel htmlFor="name" required>Nome</FieldLabel>
                <Input
                  id="name"
                  autoComplete="name"
                  aria-invalid={!!errors.name}
                  {...register('name')}
                />
                {errors.name && <FieldError>{errors.name.message}</FieldError>}
              </Field>
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
                  autoComplete="new-password"
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
                  aria-invalid={!!errors.confirmPassword}
                  {...register('confirmPassword')}
                />
                {errors.confirmPassword && (
                  <FieldError>{errors.confirmPassword.message}</FieldError>
                )}
              </Field>
              {captchaEnabled && (
                <Turnstile
                  key={captchaKey}
                  siteKey={CAPTCHA_SITE_KEY as string}
                  onVerify={setCaptchaToken}
                  onReset={() => setCaptchaToken('')}
                />
              )}
              <Button
                type="submit"
                disabled={isSubmitting || (captchaEnabled && !captchaToken)}
              >
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Criar conta
              </Button>
            </FieldGroup>
          </form>
          <OAuthButtons />
          <p className="mt-6 text-center text-sm text-muted-foreground">
            Já tem uma conta?{' '}
            <Link to="/login" className="font-medium text-primary hover:underline">
              Entrar
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
