import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ClientListFilter,
  ClientRepository,
} from '../domain/client.repository';

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ClientUncheckedCreateInput) {
    return this.prisma.client.create({ data });
  }

  findById(id: string, ownerId: string) {
    return this.prisma.client.findFirst({ where: { id, ownerId } });
  }

  async findManyAndCount(filter: ClientListFilter) {
    const where: Prisma.ClientWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.includeArchived ? {} : { archivedAt: null }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.source ? { source: filter.source } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { tradeName: { contains: filter.search, mode: 'insensitive' } },
              { document: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, ownerId: string, data: Prisma.ClientUpdateInput) {
    // updateMany garante o filtro por ownerId; retorna o registro atualizado.
    return this.prisma.client
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.client.findFirstOrThrow({ where: { id, ownerId } }),
      );
  }

  archive(id: string, ownerId: string) {
    return this.update(id, ownerId, { archivedAt: new Date() });
  }

  async existsByDocument(ownerId: string, document: string, exceptId?: string) {
    const found = await this.prisma.client.findFirst({
      where: {
        ownerId,
        document,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }
}
