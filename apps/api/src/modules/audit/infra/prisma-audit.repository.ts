import { Injectable } from '@nestjs/common';
import type { AuditEntity, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  AuditListFilter,
  AuditRepository,
} from '../domain/audit.repository';

@Injectable()
export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findManyAndCount(filter: AuditListFilter) {
    // Por `prisma.db` → dentro da transação do request, sob RLS. O filtro
    // explícito por ownerId é a convenção de todo repositório do projeto.
    const where: Prisma.AuditLogWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.entity ? { entity: filter.entity } : {}),
      ...(filter.entityId ? { entityId: filter.entityId } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.auditLog.count({ where }),
    ]);
    return { data, total };
  }

  findByEntity(
    ownerId: string,
    entity: AuditEntity,
    entityId: string,
    take: number,
  ) {
    return this.prisma.db.auditLog.findMany({
      where: { ownerId, entity, entityId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }
}
