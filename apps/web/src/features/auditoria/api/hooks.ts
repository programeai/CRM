import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { auditApi } from './audit.api';
import type { AuditEntity, ListAuditParams } from './types';

export function useAudit(params: ListAuditParams) {
  return useQuery({
    queryKey: queryKeys.audit.list(params),
    queryFn: () => auditApi.list(params),
  });
}

/**
 * Histórico de um registro. Só busca com o diálogo aberto — a trilha de um
 * registro raramente é consultada, não vale carregar em toda tela de detalhe.
 */
export function useAuditByEntity(
  entity: AuditEntity,
  entityId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.audit.byEntity(entity, entityId),
    queryFn: () => auditApi.byEntity(entity, entityId),
    enabled,
  });
}
