import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  ProposalListFilter,
  ProposalRepository,
} from '../domain/proposal.repository';

const withItems = {
  items: { orderBy: { order: 'asc' } },
  client: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaProposalRepository implements ProposalRepository {
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}

  create(data: Prisma.ProposalUncheckedCreateInput) {
    return this.prisma.db.proposal.create({ data, include: withItems });
  }

  findById(id: string) {
    return this.prisma.db.proposal.findUnique({
      where: { id },
      include: withItems,
    });
  }

  async findManyAndCount(filter: ProposalListFilter) {
    const where: Prisma.ProposalWhereInput = {
      client: { ownerId: filter.ownerId },
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? {
            OR: [
              { number: { contains: filter.search, mode: 'insensitive' } },
              {
                client: {
                  name: { contains: filter.search, mode: 'insensitive' },
                },
              },
              {
                client: {
                  email: { contains: filter.search, mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.proposal.findMany({
        where,
        include: withItems,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.proposal.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, data: Prisma.ProposalUpdateInput) {
    return this.prisma.db.proposal.update({
      where: { id },
      data,
      include: withItems,
    });
  }

  async updateWithItems(
    id: string,
    data: Prisma.ProposalUpdateInput,
    items: Omit<
      Prisma.ProposalItemUncheckedCreateWithoutProposalInput,
      'ownerId'
    >[],
  ) {
    // Atômico via transação do request (this.prisma.db); sem $transaction aninhado.
    const db = this.prisma.db;
    const { ownerId } = await db.proposal.findUniqueOrThrow({
      where: { id },
      select: { ownerId: true },
    });
    await db.proposalItem.deleteMany({ where: { proposalId: id } });
    await db.proposal.update({
      where: { id },
      data: {
        ...data,
        items: { create: items.map((it) => ({ ...it, ownerId })) },
      },
    });
    return db.proposal.findUniqueOrThrow({
      where: { id },
      include: withItems,
    });
  }

  async delete(id: string) {
    // itens primeiro (FK sem cascade); atômico via transação do request.
    const db = this.prisma.db;
    await db.proposalItem.deleteMany({ where: { proposalId: id } });
    await db.proposal.delete({ where: { id } });
  }

  async maxSequenceForYear(year: number): Promise<number> {
    // Ordena desc por `number`; como o sufixo é zero-padded (0001..9999) e o
    // prefixo é fixo por ano, a ordenação lexical coincide com a numérica.
    const last = await this.prisma.db.proposal.findFirst({
      where: { number: { startsWith: `PROP-${year}-` } },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    if (!last) return 0;
    const suffix = last.number.split('-')[2];
    return Number(suffix) || 0;
  }

  findVersionsByNumber(number: string) {
    return this.prisma.db.proposal.findMany({
      where: { number },
      include: withItems,
      orderBy: { version: 'asc' },
    });
  }

  async expireOverdue(now: Date): Promise<number> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const r = await this.admin.proposal.updateMany({
      where: {
        status: { in: ['SENT', 'NEGOTIATING'] },
        validUntil: { lt: now },
      },
      data: { status: 'EXPIRED' },
    });
    return r.count;
  }
}
