import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CopyBox } from '@/components/ui/copy-box';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { extractApiMessage } from '@/lib/api-error';
import {
  useConfirmarSegundoFator,
  useIniciarSegundoFator,
} from './api/hooks';
import type { CadastroDeSegundoFator } from './api/types';

const schema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'O código tem 6 dígitos, só números.'),
});
type Values = z.infer<typeof schema>;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Chamado ao confirmar, com os 16 códigos — a página os exibe. */
  onAtivado: (codigos: string[]) => void;
}

/**
 * Ativação do segundo fator. Duas etapas dentro do mesmo diálogo, porque são um
 * passo só para quem usa: ler o QR e digitar o código que o app mostra.
 *
 * O `setup` roda ao ABRIR, não ao confirmar — é ele que gera o segredo e o QR. E
 * ele **não liga** o 2FA: só o `confirm` liga, e só com um código válido. Sem essa
 * separação, um QR que a pessoa não conseguiu ler trancaria a conta dela.
 */
export function AtivarTotpDialog({ open, onOpenChange, onAtivado }: Props) {
  const iniciar = useIniciarSegundoFator();
  const confirmar = useConfirmarSegundoFator();
  const [cadastro, setCadastro] = useState<CadastroDeSegundoFator | null>(null);
  const [mostrarSegredo, setMostrarSegredo] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { codigo: '' },
  });

  // Abrir gera um segredo novo; fechar descarta o cadastro não confirmado.
  useEffect(() => {
    if (!open) {
      setCadastro(null);
      setMostrarSegredo(false);
      return;
    }
    reset({ codigo: '' });
    iniciar
      .mutateAsync()
      .then(setCadastro)
      .catch((err) => {
        toast.error(
          extractApiMessage(err, 'Não foi possível iniciar o cadastro do 2FA.'),
        );
        onOpenChange(false);
      });
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSubmit = async (v: Values) => {
    try {
      const { codigosDeRecuperacao } = await confirmar.mutateAsync(
        v.codigo.trim(),
      );
      onOpenChange(false);
      // Fecha antes: o diálogo dos códigos nunca fica empilhado sobre este.
      onAtivado(codigosDeRecuperacao);
    } catch (err) {
      setError('codigo', {
        message: extractApiMessage(err, 'Código inválido. Tente de novo.'),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ativar o segundo fator</DialogTitle>
          <DialogDescription>
            Leia o QR com o seu app autenticador (Google Authenticator, 1Password,
            Authy, Bitwarden) e digite o código de 6 dígitos que ele mostrar.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {cadastro ? (
            <>
              <div className="flex justify-center">
                <img
                  src={cadastro.qrDataUrl}
                  alt="QR code do segundo fator"
                  className="size-48 rounded-lg border bg-white p-2"
                />
              </div>

              {mostrarSegredo ? (
                <CopyBox
                  value={cadastro.segredoBase32}
                  copiedLabel="Segredo copiado."
                >
                  Digite este segredo no app se não conseguir ler o QR. É o
                  mesmo segredo, em outra forma — trate como senha.
                </CopyBox>
              ) : (
                <button
                  type="button"
                  className="text-sm font-medium text-primary hover:underline"
                  onClick={() => setMostrarSegredo(true)}
                >
                  Não consigo ler o QR
                </button>
              )}

              <form onSubmit={handleSubmit(onSubmit)} id="ativar-2fa-form">
                <Field data-invalid={!!errors.codigo}>
                  <FieldLabel htmlFor="codigo-2fa" required>
                    Código do app
                  </FieldLabel>
                  <Input
                    id="codigo-2fa"
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="000000"
                    aria-invalid={!!errors.codigo}
                    {...register('codigo')}
                  />
                  {errors.codigo ? (
                    <FieldError>{errors.codigo.message}</FieldError>
                  ) : (
                    <FieldDescription>
                      O código muda a cada 30 segundos.
                    </FieldDescription>
                  )}
                </Field>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <Skeleton className="mx-auto size-48" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}
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
            form="ativar-2fa-form"
            disabled={!cadastro || isSubmitting}
          >
            {isSubmitting && <Spinner data-icon="inline-start" />}
            Ativar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
