import { Checkbox } from '@/components/ui/checkbox';
import { translateNotificationType } from '@/lib/labels';
import { TIPOS } from './tipos';
import type { NotificationType } from './api/types';

/**
 * A grade compacta dos seis tipos, no cartão de um destino já cadastrado: ali
 * cada clique salva na hora, e a lista de destinos não suporta uma linha por
 * tipo. No cadastro, quem mostra os mesmos tipos é a `ListaDeEventos` do
 * `IntegracaoDialog` — com a descrição de cada um, como no catálogo de
 * permissões.
 */
export function MatrizDeTipos({
  selecionados,
  onAlternar,
  disabled = false,
}: {
  selecionados: NotificationType[];
  onAlternar: (tipo: NotificationType, marcado: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {TIPOS.map((tipo) => (
        <label
          key={tipo}
          className="flex cursor-pointer items-center gap-2 text-sm"
        >
          <Checkbox
            checked={selecionados.includes(tipo)}
            disabled={disabled}
            onCheckedChange={(marcado) => onAlternar(tipo, marcado === true)}
          />
          <span className={disabled ? 'text-muted-foreground' : undefined}>
            {translateNotificationType(tipo)}
          </span>
        </label>
      ))}
    </div>
  );
}
