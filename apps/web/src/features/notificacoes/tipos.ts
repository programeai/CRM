import { NOTIFICATION_TYPE_LABELS } from '@/lib/labels';
import type { NotificationType } from './api/types';

/**
 * Os tipos, na ordem do catálogo — o map de rótulos é a fonte da ordem. A
 * tupla (em vez de `NotificationType[]`) é o que deixa `z.enum(TIPOS)` valer no
 * schema do diálogo de integração.
 */
export const TIPOS = Object.keys(NOTIFICATION_TYPE_LABELS) as [
  NotificationType,
  ...NotificationType[],
];

/**
 * Alterna um tipo mantendo a ordem do catálogo: o `filter` sobre `TIPOS` (em vez
 * de um `push`) é o que impede a lista de embaralhar quando alguém desmarca e
 * remarca. Os dois diálogos de cadastro usam este mesmo passo.
 */
export function alternarTipo(
  atuais: NotificationType[],
  tipo: NotificationType,
): NotificationType[] {
  return atuais.includes(tipo)
    ? atuais.filter((t) => t !== tipo)
    : TIPOS.filter((t) => t === tipo || atuais.includes(t));
}

/**
 * Quando cada aviso sai — a linha de apoio embaixo do rótulo, no mesmo formato
 * do catálogo de permissões. Sem número de dias: as janelas de proposta e de
 * cobrança são constantes do backend (`DIAS_PROPOSTA`/`DIAS_COBRANCA`) e um "3
 * dias" escrito aqui envelheceria calado.
 */
export const DESCRICAO_DO_TIPO: Record<NotificationType, string> = {
  FOLLOW_UP_DUE: 'Follow-up da timeline agendado para hoje.',
  PROPOSAL_EXPIRING: 'Alguns dias antes de uma proposta expirar.',
  PAYMENT_DUE: 'Alguns dias antes de uma cobrança vencer.',
  PAYMENT_OVERDUE: 'Cobrança que passou do vencimento sem baixa.',
  TASK_OVERDUE: 'Demanda com prazo vencido e ainda não concluída.',
  RECORD_ASSIGNED: 'Alguém define você como responsável por um registro.',
  LEAD_RECEIVED: 'Um lead entra por integração (site, landing page).',
};
