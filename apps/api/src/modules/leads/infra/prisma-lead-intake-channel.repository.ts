import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  LeadIntakeChannelRecord,
  LeadIntakeChannelRepository,
} from '../domain/lead-intake-channel.repository';

const CAMPOS = {
  id: true,
  ownerId: true,
  name: true,
  assigneeId: true,
  sourceId: true,
  keyId: true,
  createdAt: true,
} as const;

/**
 * Sem client admin: **todas** as leituras deste repositório acontecem dentro de
 * contexto de owner — as do CRUD pelo `OwnerContextInterceptor`, a da ingestão
 * dentro de `PrismaService.executarComoOwner`.
 */
@Injectable()
export class PrismaLeadIntakeChannelRepository implements LeadIntakeChannelRepository {
  constructor(private readonly prisma: PrismaService) {}

  findManyByOwner(ownerId: string): Promise<LeadIntakeChannelRecord[]> {
    return this.prisma.db.leadIntakeChannel.findMany({
      where: { ownerId },
      select: CAMPOS,
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(ownerId: string, id: string) {
    return this.prisma.db.leadIntakeChannel.findFirst({
      where: { id, ownerId },
      select: CAMPOS,
    });
  }

  findByKeyId(ownerId: string, keyId: string) {
    return this.prisma.db.leadIntakeChannel.findFirst({
      where: { keyId, ownerId },
      select: CAMPOS,
    });
  }

  create(data: {
    ownerId: string;
    name: string;
    assigneeId?: string | null;
    sourceId?: string | null;
    keyId: string;
  }) {
    return this.prisma.db.leadIntakeChannel.create({ data, select: CAMPOS });
  }

  /**
   * `where: { id }` (PK) e não `{ id, ownerId }`: o RLS já fecha a linha de
   * outro owner — `FORCE ROW LEVEL SECURITY` faz o `UPDATE` casar zero linhas e
   * o Prisma responder `P2025`. Quem transforma isso em 404 legível é o service,
   * pelo `findById`.
   */
  update(
    ownerId: string,
    id: string,
    data: {
      name?: string;
      assigneeId?: string | null;
      sourceId?: string | null;
    },
  ) {
    return this.prisma.db.leadIntakeChannel.update({
      where: { id },
      data,
      select: CAMPOS,
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.leadIntakeChannel.delete({ where: { id } });
  }
}
