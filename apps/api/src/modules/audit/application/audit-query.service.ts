import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntity, AuditLog } from '@prisma/client';
import {
  AUDIT_REPOSITORY,
  type AuditRepository,
} from '../domain/audit.repository';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { ListAuditQueryDto } from '../api/dto/list-audit-query.dto';

/** Teto do histórico por registro — a tela é um diálogo, não uma listagem paginada. */
const HISTORICO_MAX = 100;

@Injectable()
export class AuditQueryService {
  constructor(
    @Inject(AUDIT_REPOSITORY) private readonly repo: AuditRepository,
  ) {}

  async list(ownerId: string, query: ListAuditQueryDto) {
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      entity: query.entity,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      from: query.from ? new Date(query.from) : undefined,
      // `to` é uma data (AAAA-MM-DD): sem isto, o filtro cortaria o dia inteiro.
      to: query.to ? fimDoDia(query.to) : undefined,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  byEntity(
    ownerId: string,
    entity: AuditEntity,
    entityId: string,
  ): Promise<AuditLog[]> {
    return this.repo.findByEntity(ownerId, entity, entityId, HISTORICO_MAX);
  }
}

/** `2026-07-26` → `2026-07-26T23:59:59.999`, para o `lte` incluir o dia todo. */
function fimDoDia(data: string): Date {
  const d = new Date(data);
  d.setHours(23, 59, 59, 999);
  return d;
}
