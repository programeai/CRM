import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ClientListFilter,
  ClientRepository,
  ClientTagRef,
} from '../domain/client.repository';
import { countTags, type TagUsage } from '../../../shared/tags';

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ClientUncheckedCreateInput) {
    return this.prisma.db.client.create({ data });
  }

  findById(id: string, ownerId: string) {
    return this.prisma.db.client.findFirst({ where: { id, ownerId } });
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
    const [data, total] = await Promise.all([
      this.prisma.db.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.client.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, ownerId: string, data: Prisma.ClientUpdateInput) {
    // updateMany garante o filtro por ownerId; retorna o registro atualizado.
    return this.prisma.db.client
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.client.findFirstOrThrow({ where: { id, ownerId } }),
      );
  }

  archive(id: string, ownerId: string) {
    return this.update(id, ownerId, { archivedAt: new Date() });
  }

  async listOwnerTags(ownerId: string): Promise<TagUsage[]> {
    // Tags são um String[] por cliente (sem catálogo próprio); a fonte de verdade
    // das "tags existentes" é a agregação distinta sobre os clientes do dono.
    // Arquivados ficam fora — não aparecem na interface.
    const rows = await this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null },
      select: { tags: true },
    });
    return countTags(rows);
  }

  findByTag(ownerId: string, tag: string): Promise<ClientTagRef[]> {
    return this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null, tags: { has: tag } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async removeTagFromAll(ownerId: string, tag: string): Promise<number> {
    // Postgres não remove elemento de array em updateMany; carrega os afetados e
    // reescreve cada array sem a tag. Roda na transação do request.
    // Inclui arquivados: a tag deixa de existir em qualquer registro do dono.
    const affected = await this.prisma.db.client.findMany({
      where: { ownerId, tags: { has: tag } },
      select: { id: true, tags: true },
    });
    await Promise.all(
      affected.map((c) =>
        this.prisma.db.client.update({
          where: { id: c.id },
          data: { tags: c.tags.filter((x) => x !== tag) },
        }),
      ),
    );
    return affected.length;
  }

  async existsByDocument(ownerId: string, document: string, exceptId?: string) {
    const found = await this.prisma.db.client.findFirst({
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
