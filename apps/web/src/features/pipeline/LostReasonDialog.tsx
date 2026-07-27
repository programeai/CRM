import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { useCatalogo } from '@/features/catalogos/api/hooks';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (lostReasonId: string) => void;
  onCancel: () => void; // reverter o move visual
}

export function LostReasonDialog({ open, onOpenChange, onConfirm, onCancel }: Props) {
  // Só os ativos: o motivo escolhido num registro NOVO tem de estar utilizável
  // — é o mesmo 422 que `assertUtilizavel` devolveria no servidor.
  const { data: motivos } = useCatalogo('motivos-de-perda');
  const [reasonId, setReasonId] = useState('');
  const [error, setError] = useState(false);
  useEffect(() => {
    if (open) {
      setReasonId('');
      setError(false);
    }
  }, [open]);

  const semCatalogo = (motivos?.length ?? 0) === 0;

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
          {semCatalogo ? (
            // Sem nenhum motivo ativo o diálogo travaria sem saída (owner que
            // apagou ou desativou todos). O link é a saída.
            <Empty>
              <EmptyTitle>Nenhum motivo de perda ativo</EmptyTitle>
              <EmptyDescription>
                Cadastre ou reative um motivo em{' '}
                <Link to="/catalogos/motivos-de-perda">Catálogos</Link> para
                registrar a perda.
              </EmptyDescription>
            </Empty>
          ) : (
            <Field data-invalid={error}>
              <FieldLabel required>Motivo</FieldLabel>
              <Select<string>
                value={reasonId}
                onValueChange={(v) => {
                  setReasonId(v ?? '');
                  if (v) setError(false);
                }}
              >
                <SelectTrigger placeholder="Selecione o motivo" />
                <SelectContent>
                  {(motivos ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {error && <FieldError>Informe o motivo da perda.</FieldError>}
            </Field>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirm} disabled={semCatalogo}>
            Confirmar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
