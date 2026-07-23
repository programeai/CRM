import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  PaymentBaseFilter,
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

  /** Monta o `where` compartilhado entre listagem e resumo (status opcional). */
  private buildWhere(
    filter: PaymentBaseFilter & { status?: PaymentListFilter['status'] },
  ): Prisma.PaymentWhereInput {
    return {
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
      ...(filter.status?.length ? { status: { in: filter.status } } : {}),
      ...(filter.dueFrom || filter.dueTo
        ? {
            dueDate: {
              ...(filter.dueFrom ? { gte: filter.dueFrom } : {}),
              ...(filter.dueTo ? { lte: filter.dueTo } : {}),
            },
          }
        : {}),
    };
  }

  async findManyAndCount(filter: PaymentListFilter) {
    const where = this.buildWhere(filter);
    const [data, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        include: withContract,
        // Agrupa por cliente e depois por contrato; dentro do contrato, por vencimento.
        orderBy: [
          { contract: { client: { name: 'asc' } } },
          { contract: { description: 'asc' } },
          { dueDate: 'asc' },
        ],
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return { data, total };
  }

  async sumByStatus(filter: PaymentBaseFilter) {
    const rows = await this.prisma.payment.groupBy({
      by: ['status'],
      where: this.buildWhere(filter),
      _sum: { amount: true, paidAmount: true },
    });
    return rows.map((r) => ({
      status: r.status,
      amount: r._sum.amount ? Number(r._sum.amount) : 0,
      paidAmount: r._sum.paidAmount ? Number(r._sum.paidAmount) : 0,
    }));
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
