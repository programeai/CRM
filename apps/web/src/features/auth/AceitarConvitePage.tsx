import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { isAxiosError } from 'axios';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useInvitePreview } from '@/features/organizacao/api/hooks';
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

/**
 * Aceite do convite de colaborador (rota pública). Ao definir a senha o
 * convidado já entra no CRM — o link chegou no e-mail dele, então pedir login
 * em seguida seria atrito sem ganho.
 */
export default function AceitarConvitePage() {
  const navigate = useNavigate();
  const { acceptInvite } = useAuth();
  const { token = '' } = useParams();
  const { data: invite, isPending, error } = useInvitePreview(token);

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
      await acceptInvite(token, v.password);
      toast.success('Acesso ativado. Bem-vindo(a) ao CRM!');
      navigate('/', { replace: true });
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível ativar o acesso. Tente novamente.';
      toast.error(message);
    }
  };

  if (isPending) {
    return (
      <AuthLayout
        title="Ativar seu acesso"
        description="Verificando o convite…"
      >
        <div className="grid min-h-32 place-items-center text-muted-foreground">
          <Spinner />
        </div>
      </AuthLayout>
    );
  }

  // Token inexistente, expirado, já usado ou acesso desativado — a API responde
  // a mesma mensagem para os três primeiros casos.
  if (error || !invite) {
    const message =
      isAxiosError(error) && typeof error.response?.data?.message === 'string'
        ? error.response.data.message
        : 'Este convite não é mais válido. Peça um novo ao responsável pela conta.';
    return (
      <AuthLayout
        title="Convite inválido"
        description="Não foi possível abrir este convite."
      >
        <div className="space-y-6">
          <p className="text-sm text-muted-foreground" role="alert">
            {message}
          </p>
          <Link
            to="/login"
            className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
          >
            Ir para o login
          </Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Ative o seu acesso"
      description={`${invite.ownerName} te convidou para colaborar no CRM. Crie uma senha para entrar.`}
    >
      <p className="mb-6 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Seu acesso: </span>
        <span className="font-medium">{invite.email}</span>
      </p>

      <form onSubmit={handleSubmit(onSubmit)}>
        <FieldGroup>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="password" required>
              Senha
            </FieldLabel>
            <PasswordInput
              id="password"
              autoComplete="new-password"
              placeholder="Mínimo de 6 caracteres"
              aria-invalid={!!errors.password}
              {...register('password')}
            />
            {errors.password && (
              <FieldError>{errors.password.message}</FieldError>
            )}
          </Field>
          <Field data-invalid={!!errors.confirmPassword}>
            <FieldLabel htmlFor="confirmPassword" required>
              Confirmar senha
            </FieldLabel>
            <PasswordInput
              id="confirmPassword"
              autoComplete="new-password"
              placeholder="Repita a senha"
              aria-invalid={!!errors.confirmPassword}
              {...register('confirmPassword')}
            />
            {errors.confirmPassword && (
              <FieldError>{errors.confirmPassword.message}</FieldError>
            )}
          </Field>
          <Button type="submit" size="lg" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Ativar acesso e entrar
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Este link vale uma única vez e expira em {invite.expiresInDays} dias.
      </p>
    </AuthLayout>
  );
}
