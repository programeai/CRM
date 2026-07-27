import { useEffect, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  useCreateRole,
  usePermissionCatalog,
  useUpdateRole,
} from './api/hooks';
import type { Role } from './api/types';

const schema = z.object({
  name: z.string().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  description: z.string().optional(),
});
type Values = z.infer<typeof schema>;

/**
 * Criação e edição de papel. As permissões vêm do catálogo do backend
 * (`GET /permissions`) — a interface nunca declara rótulo de permissão.
 */
export function PapelFormDialog({
  open,
  onOpenChange,
  role,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sem `role`, cria um novo papel; com `role`, edita o existente. */
  role?: Role;
}) {
  const isEdit = !!role;
  const { data: catalog, isLoading: loadingCatalog } = usePermissionCatalog();
  const create = useCreateRole();
  const update = useUpdateRole(role?.id ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', description: '' },
  });

  // Reabrir precisa refletir o papel corrente, não o estado da última edição.
  useEffect(() => {
    if (open) {
      reset({ name: role?.name ?? '', description: role?.description ?? '' });
      setSelected(new Set(role?.permissions ?? []));
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSubmit = async (values: Values) => {
    const body = {
      name: values.name,
      description: values.description || undefined,
      permissions: [...selected],
    };
    try {
      if (isEdit) await update.mutateAsync(body);
      else await create.mutateAsync(body);
      toast.success(isEdit ? 'Papel atualizado.' : 'Papel criado.');
      onOpenChange(false);
    } catch (err) {
      const message =
        isAxiosError(err) && typeof err.response?.data?.message === 'string'
          ? err.response.data.message
          : 'Não foi possível salvar o papel. Tente novamente.';
      // Nome duplicado é erro de campo, não de sistema.
      if (isAxiosError(err) && err.response?.status === 409) {
        setError('name', { message });
        return;
      }
      toast.error(message);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar papel' : 'Novo papel'}</DialogTitle>
          <DialogDescription>
            Marque o que este papel pode fazer. Quem tiver o papel enxerga
            apenas as áreas correspondentes.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="papel-form"
          >
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name" required>
                Nome
              </FieldLabel>
              <Input
                id="name"
                placeholder="Ex.: Comercial, Financeiro, Operação"
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Descrição</FieldLabel>
              <Input
                id="description"
                placeholder="Para que serve este papel"
                {...register('description')}
              />
            </Field>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Permissões</p>
                <span className="text-xs text-muted-foreground">
                  {selected.size} selecionada
                  {selected.size === 1 ? '' : 's'}
                </span>
              </div>

              <div className="space-y-4 rounded-lg border p-3">
                {loadingCatalog ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando permissões…
                  </p>
                ) : (
                  catalog?.map((group) => (
                    <div key={group.category} className="space-y-2">
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {group.category}
                      </p>
                      <div className="space-y-2">
                        {group.permissions.map((permission) => (
                          <label
                            key={permission.key}
                            className="flex cursor-pointer items-start gap-3 text-sm"
                          >
                            <Checkbox
                              className="mt-0.5"
                              checked={selected.has(permission.key)}
                              onCheckedChange={() => toggle(permission.key)}
                              aria-label={permission.label}
                            />
                            <span className="flex-1">
                              <span className="font-medium">
                                {permission.label}
                              </span>
                              <span className="block text-muted-foreground">
                                {permission.description}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
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
          <Button type="submit" form="papel-form" disabled={isSubmitting}>
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {isEdit ? 'Salvar' : 'Criar papel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
