import { api } from '@/lib/api';
import type { Paginated } from '@/features/clientes/api/types';
import type { AuditEntity, AuditLog, ListAuditParams } from './types';

export const auditApi = {
  list: (params: ListAuditParams) =>
    api.get<Paginated<AuditLog>>('/audit', { params }).then((r) => r.data),
  byEntity: (entity: AuditEntity, entityId: string) =>
    api
      .get<AuditLog[]>(`/audit/entities/${entity}/${entityId}`)
      .then((r) => r.data),
};
