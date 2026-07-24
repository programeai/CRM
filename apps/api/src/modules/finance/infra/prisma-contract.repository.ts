import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  ContractListFilter,
  ContractRepository,
} from '../domain/contract.repository';

const withPayments = {
  payments: { orderBy: { dueDate: 'asc' } },
  client: { select: { id: true, name: true } },
} as const;

@Injectable()
export class PrismaContractRepository implements ContractRepository {
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}

  create(data: Prisma.ContractUncheckedCreateInput) {
    return this.prisma.db.contract.create({ data, include: withPayments });
  }

  findById(id: string) {
    return this.prisma.db.contract.findUnique({
      where: { id },
      include: withPayments,
    });
  }

  async findManyAndCount(filter: ContractListFilter) {
    const where: Prisma.ContractWhereInput = {
      client: { ownerId: filter.ownerId },
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.billingType ? { billingType: filter.billingType } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.contract.findMany({
        where,
        include: withPayments,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.contract.count({ where }),
    ]);
    return { data, total };
  }

  findByClient(clientId: string) {
    return this.prisma.db.contract.findMany({
      where: { clientId },
      include: withPayments,
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.ContractUpdateInput) {
    return this.prisma.db.contract.update({
      where: { id },
      data,
      include: withPayments,
    });
  }

  findActiveRecurring() {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    return this.admin.contract.findMany({
      where: { status: 'ACTIVE', billingType: 'RECURRING' },
      include: withPayments,
    });
  }
}
