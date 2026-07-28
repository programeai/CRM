import { useEffect, useState } from 'react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { CatalogSelect } from '@/features/catalogos/CatalogSelect';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (lostReasonId: string) => void;
  onCancel: () => void; // reverter o move visual
}

export function LostReasonDialog({ open, onOpenChange, onConfirm, onCancel }: Props) {
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (open) {
      setReasonId(null);
      setError(false);
    }
  }, [open]);

  const confirm = () => {
    if (!reasonId) {
      setError(true);
      return;
    }
    onConfirm(reasonId);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
        onOpenChange(o);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Motivo da perda</DialogTitle>
          <DialogDescription>Informe por que esta oportunidade foi perdida.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* Catálogo vazio não trava mais o diálogo: o próprio seletor cadastra
              o motivo na hora, sem sair daqui. */}
          <Field data-invalid={error}>
            <FieldLabel required>Motivo</FieldLabel>
            <CatalogSelect
              kind="motivos-de-perda"
              value={reasonId}
              onChange={(id) => {
                setReasonId(id);
                if (id) setError(false);
              }}
              placeholder="Selecione o motivo"
              aria-invalid={error}
            />
            {error && <FieldError>Informe o motivo da perda.</FieldError>}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirm}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
