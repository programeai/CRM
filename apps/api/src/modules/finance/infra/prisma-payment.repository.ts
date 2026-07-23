import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  PaymentListFilter,
  PaymentRepository,
} from '../domain/payment.repository';

const withContract = {
  contract: {
    select: {
      id: true,
      description: true,
      billingType: true,
      clientId: true,
      client: { select: { id: true, name: true } },
    },
  },
} as const;

@Injectable()
export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.payment.findUnique({
      where: { id },
      include: withContract,
    });
  }

  async findManyAndCount(filter: PaymentListFilter) {
    const where: Prisma.PaymentWhereInput = {
      contract: {
        client: {
          ownerId: filter.ownerId,
          ...(filter.search
            ? { name: { contains: filter.search, mode: 'insensitive' } }
            : {}),
        },
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.billingType ? { billingType: filter.billingType } : {}),
      },
      ...(filter.contractId ? { contractId: filter.contractId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.dueFrom || filter.dueTo
        ? {
            dueDate: {
              ...(filter.dueFrom ? { gte: filter.dueFrom } : {}),
              ...(filter.dueTo ? { lte: filter.dueTo } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: withContract,
        orderBy: { dueDate: 'asc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, data: Prisma.PaymentUpdateInput) {
    return this.prisma.payment.update({
      where: { id },
      data,
      include: withContract,
    });
  }

  async existsForDueDate(contractId: string, dueDate: Date): Promise<boolean> {
    const count = await this.prisma.payment.count({
      where: { contractId, dueDate },
    });
    return count > 0;
  }

  create(data: Prisma.PaymentUncheckedCreateInput) {
    return this.prisma.payment.create({ data, include: withContract });
  }

  async markOverdue(now: Date): Promise<number> {
    const r = await this.prisma.payment.updateMany({
      where: { status: 'PENDING', dueDate: { lt: now } },
      data: { status: 'OVERDUE' },
    });
    return r.count;
  }
}
