import { useEffect, useState } from 'react';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  onCancel: () => void; // reverter o move visual
}

export function LostReasonDialog({ open, onOpenChange, onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (open) {
      setReason('');
      setError(false);
    }
  }, [open]);

  const confirm = () => {
    if (!reason.trim()) {
      setError(true);
      return;
    }
    onConfirm(reason.trim());
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
          <Field data-invalid={error}>
            <FieldLabel htmlFor="lost-reason" required>Motivo</FieldLabel>
            <textarea
              id="lost-reason"
              rows={3}
              className="min-h-20 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
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
