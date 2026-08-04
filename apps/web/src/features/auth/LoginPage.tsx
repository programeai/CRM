import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { extractApiMessage } from '@/lib/api-error';
import {
  clearCredentials,
  loadCredentials,
  saveCredentials,
} from '@/lib/remember';
import { AuthLayout } from './AuthLayout';
import { OAuthButtons } from './OAuthButtons';
import { useRegistrationEnabled } from './use-registration';

const OAUTH_ERRORS: Record<string, string> = {
  oauth: 'Não foi possível entrar com o provedor. Tente novamente.',
  oauth_indisponivel: 'Este provedor de login não está disponível no momento.',
  cadastro_desativado:
    'Esta instância não aceita novos cadastros. Peça um convite ao responsável pela conta.',
};

const schema = z.object({
  email: z.string().email('E-mail inválido'),
  password: z.string().min(6, 'Mínimo 6 caracteres'),
});
type Values = z.infer<typeof schema>;

const schema2fa = z.object({
  codigo: z.string().trim().min(6, 'Informe o código completo'),
});
type Values2fa = z.infer<typeof schema2fa>;

/**
 * Login. **Dois passos quando a conta tem segundo fator**, e nenhuma mudança em
 * `lib/api.ts` — que é a propriedade que a escolha de 200 (e não 401) na resposta
 * da API preserva: o interceptor dispara o fluxo de refresh em todo 401 e,
 * falhando, manda para /login. Um 401 no primeiro passo poria a tela em laço.
 *
 * Quem decide qual passo exibir é o CORPO da resposta: `twoFactorRequired` vira o
 * `desafio` guardado em estado local, e a presença dele troca o formulário.
 */
export default function LoginPage() {
  const { login, concluirLoginCom2fa } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [remember, setRemember] = useState(false);
  const registrationEnabled = useRegistrationEnabled();
  /** Presente = a senha foi aceita e falta o código. Nunca vai para o storage. */
  const [desafio, setDesafio] = useState<string | null>(null);
  const [usandoRecuperacao, setUsandoRecuperacao] = useState(false);
  /** Guardadas para o "Lembrar de mim" gravar só depois do segundo passo. */
  const [credenciais, setCredenciais] = useState<Values | null>(null);

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

  const form2fa = useForm<Values2fa>({
    resolver: zodResolver(schema2fa),
    defaultValues: { codigo: '' },
  });

  useEffect(() => {
    loadCredentials().then((creds) => {
      if (creds) {
        reset(creds);
        setRemember(true);
      }
    });
  }, [reset]);

  /** Grava (ou limpa) o "Lembrar de mim" e entra. */
  const concluir = async (v: Values) => {
    if (remember) await saveCredentials(v.email, v.password);
    else clearCredentials();
    navigate('/', { replace: true });
  };

  const onSubmit = async (v: Values) => {
    try {
      const r = await login(v.email, v.password);
      if (r.autenticado) {
        await concluir(v);
        return;
      }
      // Segundo fator: guarda o desafio e as credenciais, e troca o formulário.
      setCredenciais(v);
      setDesafio(r.desafio);
      form2fa.reset({ codigo: '' });
    } catch {
      toast.error('Credenciais inválidas');
    }
  };

  const onSubmit2fa = async (v: Values2fa) => {
    if (!desafio) return;
    try {
      await concluirLoginCom2fa(desafio, v.codigo.trim());
      if (credenciais) await concluir(credenciais);
      else navigate('/', { replace: true });
    } catch (err) {
      const mensagem = extractApiMessage(err, 'Código inválido ou expirado.');
      /*
        Desafio expirado (5 min) volta ao passo 1: insistir no campo de código
        seria pedir para digitar num desafio que não vale mais. A mensagem da API
        já diz o que fazer.
      */
      if (mensagem.includes('expirou')) {
        setDesafio(null);
        setCredenciais(null);
        setUsandoRecuperacao(false);
        toast.error(mensagem);
        return;
      }
      form2fa.setError('codigo', { message: mensagem });
    }
  };

  const voltarAoPrimeiroPasso = () => {
    setDesafio(null);
    setCredenciais(null);
    setUsandoRecuperacao(false);
  };

  if (desafio) {
    return (
      <AuthLayout
        title="Confirme que é você"
        description={
          usandoRecuperacao
            ? 'Informe um dos códigos de recuperação que você guardou ao ativar o segundo fator.'
            : 'Abra o app autenticador e informe o código de 6 dígitos.'
        }
      >
        <form onSubmit={form2fa.handleSubmit(onSubmit2fa)}>
          <FieldGroup>
            <Field data-invalid={!!form2fa.formState.errors.codigo}>
              <FieldLabel htmlFor="codigo" required>
                {usandoRecuperacao ? 'Código de recuperação' : 'Código'}
              </FieldLabel>
              <Input
                id="codigo"
                // `one-time-code` faz o iOS/Android oferecerem o código do app
                // autenticador (e o do SMS, quando houver) no teclado.
                autoComplete="one-time-code"
                inputMode={usandoRecuperacao ? 'text' : 'numeric'}
                autoFocus
                placeholder={usandoRecuperacao ? 'A1B2C3D4-E5F6G7H8' : '000000'}
                aria-invalid={!!form2fa.formState.errors.codigo}
                {...form2fa.register('codigo')}
              />
              {form2fa.formState.errors.codigo ? (
                <FieldError>
                  {form2fa.formState.errors.codigo.message}
                </FieldError>
              ) : (
                <FieldDescription>
                  A confirmação vale por 5 minutos.
                </FieldDescription>
              )}
            </Field>
            <Button
              type="submit"
              size="lg"
              disabled={form2fa.formState.isSubmitting}
            >
              {form2fa.formState.isSubmitting && (
                <Spinner data-icon="inline-start" />
              )}
              Entrar
            </Button>
            <div className="flex items-center justify-between">
              <button
                type="button"
                className="text-sm font-medium text-primary hover:underline"
                onClick={() => {
                  setUsandoRecuperacao((atual) => !atual);
                  form2fa.reset({ codigo: '' });
                }}
              >
                {usandoRecuperacao
                  ? 'Usar o app autenticador'
                  : 'Usar um código de recuperação'}
              </button>
              <button
                type="button"
                className="text-sm font-medium text-muted-foreground hover:underline"
                onClick={voltarAoPrimeiroPasso}
              >
                Entrar com outra conta
              </button>
            </div>
          </FieldGroup>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Bem-vindo de volta"
      description="Acesse sua conta para gerenciar o comercial da agência."
    >
      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="email" required>
              E-mail
            </FieldLabel>
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
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password" required>
              Senha
            </FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && (
              <FieldError>{errors.password.message}</FieldError>
            )}
          </Field>
          <div className="flex items-center justify-between">
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
            <Link
              to="/esqueci-senha"
              className="shrink-0 whitespace-nowrap text-sm font-medium text-primary hover:underline"
            >
              Esqueci minha senha
            </Link>
          </div>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Entrar
          </Button>
        </FieldGroup>
      </form>
      <OAuthButtons />
      {registrationEnabled !== false && (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          Não tem uma conta?{' '}
          <Link
            to="/registrar"
            className="font-medium text-primary hover:underline"
          >
            Criar conta
          </Link>
        </p>
      )}
    </AuthLayout>
  );
}
