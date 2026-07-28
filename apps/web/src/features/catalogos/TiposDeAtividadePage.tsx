import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Star, Trash2 } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { SectionHeading } from '@/components/ui/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { extractApiMessage } from '@/lib/api-error';
import {
  useCatalogo,
  useCreateCatalogItem,
  useDeleteCatalogItem,
  useUpdateCatalogItem,
} from './api/hooks';
import type { CatalogItem } from './api/types';

const KIND = 'tipos-de-atividade' as const;

/**
 * O único catálogo com tela própria. Os outros três vivem inteiros dentro do
 * `CatalogSelect`, no formulário onde fazem falta — este não pode, porque
 * carrega a marca de follow-up: exatamente um tipo por owner é o que o cron de
 * lembretes e o bloco "Próximas ações" do painel procuram. Isso é regra, e regra
 * não se escolhe de dentro de um dropdown no meio de outro cadastro.
 *
 * Renomear não existe aqui, como em nenhum catálogo: troca-se o item por outro.
 */
export default function TiposDeAtividadePage() {
  const { data, isLoading } = useCatalogo(KIND);
  const update = useUpdateCatalogItem(KIND);
  const remove = useDeleteCatalogItem(KIND);
  const [cadastrando, setCadastrando] = useState(false);

  const itens = [...(data ?? [])].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  );

  const marcarFollowUp = async (item: CatalogItem) => {
    try {
      await update.mutateAsync({ id: item.id, body: { isFollowUp: true } });
      toast.success(`Os lembretes de follow-up agora usam “${item.name}”.`);
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao mover a marca de follow-up.'));
    }
  };

  const excluir = async (item: CatalogItem) => {
    try {
      const { ocultado, usos } = await remove.mutateAsync(item.id);
      toast.success(
        ocultado
          ? `${item.name} excluído. ${usos} ${usos === 1 ? 'atividade que já usava continua exibindo' : 'atividades que já usavam continuam exibindo'} o nome.`
          : `${item.name} excluído.`,
      );
    } catch (err) {
      toast.error(extractApiMessage(err, 'Falha ao excluir o tipo de atividade.'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading
        title="Tipos de atividade"
        description="Classificam as atividades da timeline. Exatamente um tipo carrega a marca de follow-up: é por ela que os lembretes diários e o bloco “Próximas ações” do painel encontram as atividades agendadas."
      >
        <Button onClick={() => setCadastrando(true)}>
          <Plus data-icon="inline-start" />
          Adicionar
        </Button>
      </SectionHeading>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      ) : itens.length === 0 ? (
        <p className="rounded-lg border py-10 text-center text-sm text-muted-foreground">
          Nenhum tipo de atividade cadastrado ainda.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {itens.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {item.name}
              </span>

              {item.isFollowUp ? (
                <Badge variant="secondary" className="gap-1">
                  <Star className="size-3" />
                  Lembretes de follow-up
                </Badge>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  disabled={update.isPending}
                  onClick={() => void marcarFollowUp(item)}
                >
                  Usar nos lembretes
                </Button>
              )}

              {/* O tipo marcado não pode sumir: sem nenhum, o cron silencia. */}
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive"
                disabled={item.isFollowUp || remove.isPending}
                title={
                  item.isFollowUp
                    ? 'Marque outro tipo para os lembretes antes de excluir este'
                    : undefined
                }
                aria-label={`Excluir ${item.name}`}
                onClick={() => void excluir(item)}
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <NovoTipoDialog open={cadastrando} onOpenChange={setCadastrando} />
    </div>
  );
}

const schema = z.object({
  name: z.string().trim().min(2, 'O nome deve ter no mínimo 2 caracteres.'),
  isFollowUp: z.boolean(),
});
type Values = z.infer<typeof schema>;

function NovoTipoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const create = useCreateCatalogItem(KIND);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', isFollowUp: false },
  });

  useEffect(() => {
    if (open) reset({ name: '', isFollowUp: false });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (values: Values) => {
    try {
      await create.mutateAsync({
        name: values.name,
        ...(values.isFollowUp ? { isFollowUp: true } : {}),
      });
      toast.success('Tipo de atividade cadastrado.');
      onOpenChange(false);
    } catch (err) {
      const message = extractApiMessage(
        err,
        'Falha ao cadastrar o tipo de atividade.',
      );
      setError('name', { message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo tipo de atividade</DialogTitle>
          <DialogDescription>
            Cadastrar um nome que já existiu e foi excluído traz o item de volta,
            com as atividades antigas ainda ligadas a ele.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="tipo-atividade-form"
          >
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="tipo-atividade-nome" required>
                Nome
              </FieldLabel>
              <Input
                id="tipo-atividade-nome"
                placeholder="Ex.: Ligação, Reunião, E-mail"
                autoFocus
                aria-invalid={!!errors.name}
                {...register('name')}
              />
              {errors.name && <FieldError>{errors.name.message}</FieldError>}
            </Field>

            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={watch('isFollowUp')}
                onCheckedChange={(checked) =>
                  setValue('isFollowUp', !!checked)
                }
              />
              <span className="flex-1">
                <span className="font-medium">
                  Usar nos lembretes de follow-up
                </span>
                <span className="block text-muted-foreground">
                  Transfere a marca do tipo que a carrega hoje.
                </span>
              </span>
            </label>
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
            form="tipo-atividade-form"
            disabled={isSubmitting}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Cadastrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
