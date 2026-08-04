import { NOTIFICATION_TYPES } from '@/lib/labels';
import type { NotificationType } from './api/types';

/**
 * Alterna um tipo mantendo a ordem do catálogo: o `filter` sobre
 * `NOTIFICATION_TYPES` (em vez de um `push`) é o que impede a lista de
 * embaralhar quando alguém desmarca e remarca. Os dois diálogos de cadastro
 * usam este mesmo passo.
 *
 * A lista de tipos e as descrições moraram aqui até a página de ajuda passar a
 * precisar das duas: subiram para `@/lib/labels`, junto dos rótulos.
 */
export function alternarTipo(
  atuais: NotificationType[],
  tipo: NotificationType,
): NotificationType[] {
  return atuais.includes(tipo)
    ? atuais.filter((t) => t !== tipo)
    : NOTIFICATION_TYPES.filter((t) => t === tipo || atuais.includes(t));
}
