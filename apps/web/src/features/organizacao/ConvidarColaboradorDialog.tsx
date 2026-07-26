import { useEffect, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useCreateCollaborator } from './api/hooks';
import { LinkConviteBox } from './LinkConviteBox';
import type { Role } from './api/types';

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  email: z.string().email('E-mail inválido.'),
  roleId: z.string().min(1, 'Selecione um papel.'),
});
type Values = z.infer<typeof schema>;

export function ConvidarColaboradorDialog({
  open,
  onOpenChange,
  roles,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roles: Role[];
}) {
  const create = useCreateCollaborator();
  // Enquanto preenchido, o diálogo mostra o link gerado em vez do formulário.
  const [invite, setInvite] = useState<{
    url: string;
    expiresInDays: number;
    name: string;
  } | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', roleId: '' },
  });

  // Reabrir o diálogo tem de começar limpo, sem o link do convite anterior.
  useEffect(() => {
    if (open) {
      setInvite(null);
      reset({ name: '', email: '', roleId: roles[0]?.id ?? '' });
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: Values) => {
    try {
      const result = await create.mutateAsync(values);
      setInvite({
        url: result.inviteUrl,
        expiresInDays: result.inviteExpiresInDays,
        name: result.collaborator.name,
      });
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível convidar o colaborador. Tente novamente.';
      // Conflito de e-mail é erro de campo, não de sistema.
      if (isAxiosError(err) && err.response?.status === 409) {
        setError('email', { message });
        return;
      }
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {invite ? (
          <>
            <DialogHeader>
              <DialogTitle>Convite enviado</DialogTitle>
              <DialogDescription>
                Enviamos o convite por e-mail para {invite.name}. Se preferir,
                repasse o link abaixo por outro canal.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <LinkConviteBox
                url={invite.url}
                expiresInDays={invite.expiresInDays}
              />
            </DialogBody>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Convidar colaborador</DialogTitle>
              <DialogDescription>
                Ele recebe um link por e-mail para criar a própria senha. O
                acesso é definido pelo papel escolhido.
              </DialogDescription>
            </DialogHeader>

            <DialogBody>
              <form
                className="space-y-4"
                onSubmit={handleSubmit(onSubmit)}
                id="convidar-colaborador-form"
              >
                <Field data-invalid={!!errors.name}>
                  <FieldLabel htmlFor="name" required>
                    Nome
                  </FieldLabel>
                  <Input
                    id="name"
                    placeholder="Como o colaborador aparece no CRM"
                    aria-invalid={!!errors.name}
                    {...register('name')}
                  />
                  {errors.name && (
                    <FieldError>{errors.name.message}</FieldError>
                  )}
                </Field>

                <Field data-invalid={!!errors.email}>
                  <FieldLabel htmlFor="email" required>
                    E-mail
                  </FieldLabel>
                  <Input
                    id="email"
                    type="email"
                    placeholder="nome@empresa.com.br"
                    aria-invalid={!!errors.email}
                    {...register('email')}
                  />
                  {errors.email && (
                    <FieldError>{errors.email.message}</FieldError>
                  )}
                </Field>

                <Field data-invalid={!!errors.roleId}>
                  <FieldLabel required>Papel</FieldLabel>
                  <Controller
                    control={control}
                    name="roleId"
                    render={({ field }) => (
                      <Select<string>
                        items={roles.map((r) => ({
                          value: r.id,
                          label: r.name,
                        }))}
                        value={field.value}
                        onValueChange={(v) => field.onChange(v)}
                      >
                        <SelectTrigger placeholder="Selecione um papel" />
                        <SelectContent>
                          {roles.map((role) => (
                            <SelectItem key={role.id} value={role.id}>
                              {role.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  {errors.roleId && (
                    <FieldError>{errors.roleId.message}</FieldError>
                  )}
                </Field>
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
                form="convidar-colaborador-form"
                disabled={isSubmitting}
              >
                {isSubmitting && <Spinner data-icon="inline-start" />}
                Enviar convite
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
