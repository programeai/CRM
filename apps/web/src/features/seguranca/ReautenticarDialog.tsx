import { useEffect, useState } from 'react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import type { Reautenticacao } from './api/types';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  /**
   * `false` = conta de login social sem senha definida. Aí a prova é um código do
   * autenticador — é o caminho que a API aceita para ela (`passwordSetAt`, e não
   * `passwordHash IS NOT NULL`, é quem responde "esta pessoa sabe uma senha?").
   */
  temSenha: boolean;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  destructive?: boolean;
  onConfirm: (confirmacao: Reautenticacao) => void;
}

/**
 * Reautenticação para uma ação sobre o próprio segundo fator (OWASP ASVS 3.7.1):
 * a senha **ou** um código do autenticador, conforme a conta tenha senha ou não.
 *
 * Existe porque o `ConfirmTypedDialog` só sabe pedir senha, e a conta que entrou
 * por login social não tem uma — sem este diálogo, ela ficaria sem caminho para
 * gerar códigos novos, o que é justamente quando ela mais precisa deles.
 *
 * Herda do `AlertDialog` do design system, então a pilha global de modais
 * continua valendo.
 */
export function ReautenticarDialog({
  open,
  onOpenChange,
  title,
  description,
  temSenha,
  confirmLabel = 'Confirmar',
  pendingLabel = 'Processando…',
  pending = false,
  destructive = false,
  onConfirm,
}: Props) {
  const [valor, setValor] = useState('');

  useEffect(() => {
    if (!open) setValor('');
  }, [open]);

  const habilitado = temSenha ? valor.length > 0 : /^\d{6}$/.test(valor.trim());

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <Field>
          <FieldLabel htmlFor="reautenticar-valor" required>
            {temSenha ? 'Sua senha' : 'Código do app autenticador'}
          </FieldLabel>
          {temSenha ? (
            <PasswordInput
              id="reautenticar-valor"
              autoComplete="current-password"
              value={valor}
              onChange={(e) => setValor(e.target.value)}
            />
          ) : (
            <>
              <Input
                id="reautenticar-valor"
                autoComplete="one-time-code"
                inputMode="numeric"
                placeholder="000000"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <FieldDescription>
                Você entrou por login social e não tem senha definida — a
                confirmação é pelo app autenticador.
              </FieldDescription>
            </>
          )}
        </Field>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant={destructive ? 'destructive' : 'default'}
            disabled={!habilitado || pending}
            onClick={() =>
              onConfirm(
                temSenha
                  ? { password: valor }
                  : { codigo: valor.trim() },
              )
            }
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
