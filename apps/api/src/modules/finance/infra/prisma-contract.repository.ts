import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
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
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ContractUncheckedCreateInput) {
    return this.prisma.contract.create({ data, include: withPayments });
  }

  findById(id: string) {
    return this.prisma.contract.findUnique({
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
    const [data, total] = await this.prisma.$transaction([
      this.prisma.contract.findMany({
        where,
        include: withPayments,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return { data, total };
  }

  findByClient(clientId: string) {
    return this.prisma.contract.findMany({
      where: { clientId },
      include: withPayments,
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.ContractUpdateInput) {
    return this.prisma.contract.update({
      where: { id },
      data,
      include: withPayments,
    });
  }

  findActiveRecurring() {
    return this.prisma.contract.findMany({
      where: { status: 'ACTIVE', billingType: 'RECURRING' },
      include: withPayments,
    });
  }
}
