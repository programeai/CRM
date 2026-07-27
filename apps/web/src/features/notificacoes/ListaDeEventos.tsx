import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { translateNotificationType } from '@/lib/labels';
import { DESCRICAO_DO_TIPO, TIPOS } from './tipos';
import type { NotificationType } from './api/types';

/**
 * Os eventos entregáveis, no mesmo formato do catálogo de permissões do
 * `PapelFormDialog`: contador à direita do rótulo, caixa com borda e, em cada
 * linha, o rótulo com a descrição do quando embaixo. Serve os dois cadastros —
 * e-mail e integração —, que escolhem os mesmos seis tipos.
 */
export function ListaDeEventos({
  selecionados,
  onAlternar,
  erro,
}: {
  selecionados: NotificationType[];
  /** Recebe o tipo clicado; quem chama decide marcar ou desmarcar. */
  onAlternar: (tipo: NotificationType) => void;
  erro?: string;
}) {
  return (
    <Field data-invalid={!!erro}>
      <div className="flex items-center justify-between gap-2">
        <FieldLabel required>Eventos</FieldLabel>
        <span className="text-xs text-muted-foreground">
          {selecionados.length} selecionado
          {selecionados.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        {TIPOS.map((tipo) => (
          <label
            key={tipo}
            className="flex cursor-pointer items-start gap-3 text-sm"
          >
            <Checkbox
              className="mt-0.5"
              checked={selecionados.includes(tipo)}
              onCheckedChange={() => onAlternar(tipo)}
              aria-label={translateNotificationType(tipo)}
            />
            <span className="flex-1">
              <span className="font-medium">
                {translateNotificationType(tipo)}
              </span>
              <span className="block text-muted-foreground">
                {DESCRICAO_DO_TIPO[tipo]}
              </span>
            </span>
          </label>
        ))}
      </div>

      {erro && <FieldError>{erro}</FieldError>}
    </Field>
  );
}
