import type { AuditAction, AuditEntity, AuditLog } from '@prisma/client';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

export interface AuditListFilter {
  ownerId: string;
  entity?: AuditEntity;
  entityId?: string;
  actorId?: string;
  action?: AuditAction;
  from?: Date;
  to?: Date;
  skip: number;
  take: number;
}

export interface AuditRepository {
  findManyAndCount(
    filter: AuditListFilter,
  ): Promise<{ data: AuditLog[]; total: number }>;
  findByEntity(
    ownerId: string,
    entity: AuditEntity,
    entityId: string,
    take: number,
  ): Promise<AuditLog[]>;
}
