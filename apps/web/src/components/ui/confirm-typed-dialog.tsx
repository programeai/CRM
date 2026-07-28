import * as React from "react"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"

interface ConfirmTypedDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: React.ReactNode
  /** O texto que precisa ser digitado (ex.: o e-mail da conta). */
  expected: string
  expectedLabel: string
  /** Quando `true`, exige também a senha — devolvida em `onConfirm`. */
  secret?: boolean
  secretLabel?: string
  confirmLabel?: string
  pendingLabel?: string
  pending?: boolean
  onConfirm: (senha?: string) => void
}

/**
 * Confirmação por digitação: o usuário reproduz um texto exato antes de o botão
 * destrutivo habilitar. É o "nonstandard action" que a NN/g reserva às operações
 * mais perigosas — e por isso mesmo o `ConfirmDialog` comum continua sendo o
 * padrão da casa: usar este em tudo o esvaziaria.
 *
 * Herda do `AlertDialog` do design system, então a pilha global de modais
 * (`modal-stack`) continua valendo — nada de diálogo com estado próprio.
 */
export function ConfirmTypedDialog({
  open,
  onOpenChange,
  title,
  description,
  expected,
  expectedLabel,
  secret = false,
  secretLabel = "Senha",
  confirmLabel = "Confirmar",
  pendingLabel = "Processando…",
  pending = false,
  onConfirm,
}: ConfirmTypedDialogProps) {
  const [digitado, setDigitado] = React.useState("")
  const [senha, setSenha] = React.useState("")

  React.useEffect(() => {
    if (!open) {
      setDigitado("")
      setSenha("")
    }
  }, [open])

  const habilitado = digitado.trim() === expected && (!secret || senha.length > 0)

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="confirm-typed-expected" required>
              Digite {expectedLabel} para confirmar
            </FieldLabel>
            <Input
              id="confirm-typed-expected"
              autoComplete="off"
              value={digitado}
              onChange={(e) => setDigitado(e.target.value)}
              placeholder={expected}
            />
          </Field>
          {secret && (
            <Field>
              <FieldLabel htmlFor="confirm-typed-secret" required>
                {secretLabel}
              </FieldLabel>
              <PasswordInput
                id="confirm-typed-secret"
                autoComplete="current-password"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
              />
            </Field>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={!habilitado || pending}
            onClick={() => onConfirm(secret ? senha : undefined)}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
