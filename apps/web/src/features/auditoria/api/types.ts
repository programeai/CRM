import type {
  AUDIT_ACTION_LABELS,
  AUDIT_ACTOR_TYPE_LABELS,
  AUDIT_ENTITY_LABELS,
} from '@/lib/labels';

export type AuditActorType = keyof typeof AUDIT_ACTOR_TYPE_LABELS;
export type AuditEntity = keyof typeof AUDIT_ENTITY_LABELS;
export type AuditAction = keyof typeof AUDIT_ACTION_LABELS;

/**
 * Uma mudança registrada na trilha.
 *
 * `actorName` e `entityLabel` são denormalizados no backend: guardam o que era
 * verdade **no momento da ação**, então renomear um colaborador ou um contrato
 * não reescreve o passado.
 */
export type AuditLog = {
  id: string;
  actorType: AuditActorType;
  /** `null` quando não há pessoa por trás (cron, webhook). */
  actorId: string | null;
  actorName: string;
  entity: AuditEntity;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  /**
   * `{ campo: { antes, depois } }` dos campos alterados, mesclado com o contexto
   * extra da ação (ex.: `cobrancasCanceladas: 3`). `null` em ação sem diff.
   */
  diff: Record<string, unknown> | null;
  /** Mesmo `x-request-id` do log estruturado — amarra a trilha ao Loki. */
  requestId: string | null;
  createdAt: string;
};

export type ListAuditParams = {
  page?: number;
  limit?: number;
  entity?: AuditEntity;
  entityId?: string;
  actorId?: string;
  action?: AuditAction;
  /** `AAAA-MM-DD` */
  from?: string;
  /** `AAAA-MM-DD` — inclui o dia inteiro. */
  to?: string;
};
