import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { extractApiMessage } from '@/lib/api-error';
import { useCriarChave, useEscopos } from './api/hooks';

const schema = z.object({
  nome: z
    .string()
    .trim()
    .min(2, 'Mínimo 2 caracteres')
    .max(80, 'Máximo 80 caracteres'),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado ao criar, com o valor bruto — a página exibe num diálogo próprio. */
  onCriado: (resultado: { valor: string; nome: string }) => void;
}

/**
 * Emissão de chave de API avulsa. Só criação — para trocar o segredo existe
 * "Rotacionar chave" na tabela, e não há edição de nome nem de escopo depois:
 * quem quer outro conjunto de escopos cria outra chave.
 */
export function ChaveDialog({ open, onOpenChange, onCriado }: Props) {
  const { data: catalogo, isLoading: carregandoEscopos } = useEscopos();
  // `lead:receber` pertence ao canal de captação: a rota de criação avulsa
  // recusa esse escopo, então ele não entra na lista de opções.
  const escopos = catalogo?.filter((e) => e.key !== 'lead:receber');
  const criar = useCriarChave();
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { nome: '' },
  });

  useEffect(() => {
    if (open) {
      reset({ nome: '' });
      setSelecionados(new Set());
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const alternar = (key: string) => {
    setSelecionados((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onSubmit = async (values: Values) => {
    try {
      const emitida = await criar.mutateAsync({
        nome: values.nome,
        escopos: [...selecionados],
      });
      onOpenChange(false);
      onCriado({ valor: emitida.valor, nome: emitida.chave.nome });
    } catch (err) {
      toast.error(
        extractApiMessage(err, 'Não foi possível criar a chave. Tente novamente.'),
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nova chave de API</DialogTitle>
          <DialogDescription>
            Ao salvar, geramos o valor que o seu sistema usa no cabeçalho
            Authorization. Ele aparece uma única vez.
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <form
            className="space-y-4"
            onSubmit={handleSubmit(onSubmit)}
            id="chave-de-api-form"
          >
            <Field data-invalid={!!errors.nome}>
              <FieldLabel htmlFor="nome" required>
                Nome
              </FieldLabel>
              <Input
                id="nome"
                placeholder="ERP da produção, automação de faturamento…"
                aria-invalid={!!errors.nome}
                {...register('nome')}
              />
              {errors.nome && <FieldError>{errors.nome.message}</FieldError>}
            </Field>

            <div className="space-y-3">
              <FieldLabel required>Escopos</FieldLabel>
              <div className="space-y-2 rounded-lg border p-3">
                {carregandoEscopos ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando escopos…
                  </p>
                ) : (
                  escopos?.map((escopo) => (
                    <label
                      key={escopo.key}
                      className="flex cursor-pointer items-start gap-3 text-sm"
                    >
                      <Checkbox
                        className="mt-0.5"
                        checked={selecionados.has(escopo.key)}
                        onCheckedChange={() => alternar(escopo.key)}
                        aria-label={escopo.label}
                      />
                      <span className="flex-1">
                        <span className="font-medium">{escopo.label}</span>
                        <span className="block text-muted-foreground">
                          {escopo.description}
                        </span>
                      </span>
                    </label>
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
          <Button
            type="submit"
            form="chave-de-api-form"
            disabled={isSubmitting || selecionados.size === 0}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Criar chave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
