import { useEffect } from 'react';
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
import { AssigneeSelect } from '@/components/ui/assignee-select';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { CatalogSelect } from '@/features/catalogos/CatalogSelect';
import { extractApiMessage } from '@/lib/api-error';
import { useCreateCanal, useUpdateCanal } from './api/hooks';
import type { CanalDeCaptacao } from './api/types';

const schema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(60, 'Máximo 60 caracteres'),
  assigneeId: z.string().nullable(),
  sourceId: z.string().nullable(),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Ausente = criação. Presente = edição (sem chave nova). */
  canal?: CanalDeCaptacao | null;
  /** Chamado na criação, com o valor bruto da chave — a página o exibe. */
  onCriado: (resultado: { chave: string; nome: string }) => void;
}

/**
 * Formulário do canal de captação. Na **criação** o salvamento emite a chave, e
 * quem exibe o valor é a página, num diálogo próprio — nunca empilhado sobre
 * este (a regra dos modais é absoluta). Na **edição** não há chave nova: para
 * trocar o segredo existe "Rotacionar chave".
 */
export function CanalDialog({ open, onOpenChange, canal, onCriado }: Props) {
  const create = useCreateCanal();
  const update = useUpdateCanal();
  const editando = Boolean(canal);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', assigneeId: null, sourceId: null },
  });

  // Reabrir tem de partir do canal em edição (ou limpo, na criação).
  useEffect(() => {
    if (open) {
      reset({
        name: canal?.name ?? '',
        assigneeId: canal?.assignee?.id ?? null,
        sourceId: canal?.source?.id ?? null,
      });
    }
  }, [open, canal]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: Values) => {
    try {
      if (canal) {
        await update.mutateAsync({ id: canal.id, body: values });
        toast.success('Canal atualizado.');
        onOpenChange(false);
        return;
      }
      const criado = await create.mutateAsync(values);
      onOpenChange(false);
      onCriado({ chave: criado.chave, nome: criado.canal.name });
    } catch (err) {
      const message = extractApiMessage(
        err,
        'Não foi possível salvar o canal. Tente novamente.',
      );
      // Nome repetido é erro de campo, não de sistema.
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
          <DialogTitle>{editando ? 'Editar canal' : 'Novo canal'}</DialogTitle>
          <DialogDescription>
            {editando
              ? 'Quem atende e como o lead é classificado. A chave atual continua valendo.'
              : 'Ao salvar, geramos a chave que o seu site usa para entregar o lead. Ela aparece uma única vez.'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="canal-de-captacao-form"
          >
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="name" required>
                Nome do canal
              </FieldLabel>
              <Input
                id="name"
                placeholder="Site institucional, Landing agenda cheia, n8n…"
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <Field>
              <FieldLabel>Responsável</FieldLabel>
              <Controller
                control={control}
                name="assigneeId"
                render={({ field }) => (
                  <AssigneeSelect
                    value={field.value}
                    onValueChange={field.onChange}
                    current={canal?.assignee ?? null}
                  />
                )}
              />
              {/* A consequência de `shared/record-scope.ts` precisa estar na tela. */}
              <p className="text-xs text-muted-foreground">
                Todo lead deste canal nasce com essa pessoa. Sem responsável, o
                lead fica visível para toda a equipe.
              </p>
            </Field>

            <Field>
              <FieldLabel>Fonte de lead</FieldLabel>
              <Controller
                control={control}
                name="sourceId"
                render={({ field }) => (
                  <CatalogSelect
                    kind="fontes-de-lead"
                    value={field.value}
                    onChange={field.onChange}
                    /*
                      Fonte já gravada no canal, mesmo que tenha sido excluída
                      do catálogo depois: sem isto, abrir um canal cuja fonte
                      sumiu apagaria o valor do campo.
                    */
                    currentItem={canal?.source ?? null}
                    clearLabel="Não classificar"
                  />
                )}
              />
              <p className="text-xs text-muted-foreground">
                Classifica o lead nos relatórios. A origem que o site manda
                continua sendo gravada como tag, junto disto.
              </p>
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
            form="canal-de-captacao-form"
            disabled={isSubmitting}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            {editando ? 'Salvar' : 'Criar canal e gerar chave'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
