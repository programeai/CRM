import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  PaymentBaseFilter,
  PaymentListFilter,
  PaymentRepository,
  PaymentSortField,
  PaymentVencido,
  SortDirection,
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
  constructor(
    private prisma: PrismaService,
    private admin: PrismaAdminService,
  ) {}

  findById(id: string) {
    return this.prisma.db.payment.findUnique({
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
        client: { ownerId: filter.ownerId },
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.billingType ? { billingType: filter.billingType } : {}),
        // Busca por nome do cliente OU descrição do contrato.
        ...(filter.search
          ? {
              OR: [
                {
                  description: { contains: filter.search, mode: 'insensitive' },
                },
                {
                  client: {
                    name: { contains: filter.search, mode: 'insensitive' },
                  },
                },
              ],
            }
          : {}),
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
    const dir: SortDirection = filter.sortDir === 'desc' ? 'desc' : 'asc';
    const total = await this.prisma.db.payment.count({ where });

    // Ordenar por status exige prioridade customizada (Vencido → Pendente →
    // Pago → Cancelado), que o Prisma não expressa (ele usa a ordem do enum).
    // É também o padrão quando nenhuma coluna é escolhida. Nesse caso buscamos
    // os IDs já ordenados via SQL e hidratamos com o Prisma (mantém os tipos).
    if (!filter.sortBy || filter.sortBy === 'status') {
      const ids = await this.orderedIdsByStatus(filter, dir);
      if (ids.length === 0) return { data: [], total };
      const rows = await this.prisma.db.payment.findMany({
        where: { id: { in: ids } },
        include: withContract,
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const data = ids.map((id) => byId.get(id)).filter((r) => r != null);
      return { data, total };
    }

    const data = await this.prisma.db.payment.findMany({
      where,
      include: withContract,
      orderBy: this.prismaOrderBy(filter.sortBy, dir),
      skip: filter.skip,
      take: filter.take,
    });
    return { data, total };
  }

  /** ORDER BY nativo do Prisma para as colunas simples (não-status). */
  private prismaOrderBy(
    sortBy: Exclude<PaymentSortField, 'status'>,
    dir: SortDirection,
  ): Prisma.PaymentOrderByWithRelationInput[] {
    switch (sortBy) {
      case 'client':
        return [
          { contract: { client: { name: dir } } },
          { contract: { description: 'asc' } },
          { dueDate: 'asc' },
        ];
      case 'contract':
        return [{ contract: { description: dir } }, { dueDate: 'asc' }];
      case 'amount':
        return [{ amount: dir }, { dueDate: 'asc' }];
      case 'dueDate':
      default:
        return [{ dueDate: dir }];
    }
  }

  /**
   * IDs da página ordenados por prioridade de status (e depois cliente →
   * contrato → vencimento), via SQL. `dir` inverte só a prioridade do status.
   * O `WHERE` espelha `buildWhere` — mantenha os dois em sincronia.
   */
  private async orderedIdsByStatus(
    filter: PaymentListFilter,
    dir: SortDirection,
  ): Promise<string[]> {
    const conds: Prisma.Sql[] = [Prisma.sql`cl."ownerId" = ${filter.ownerId}`];
    if (filter.search)
      conds.push(
        Prisma.sql`(cl.name ILIKE ${`%${filter.search}%`} OR c.description ILIKE ${`%${filter.search}%`})`,
      );
    if (filter.clientId)
      conds.push(Prisma.sql`c."clientId" = ${filter.clientId}`);
    if (filter.billingType)
      conds.push(
        Prisma.sql`c."billingType" = ${filter.billingType}::"BillingType"`,
      );
    if (filter.contractId)
      conds.push(Prisma.sql`p."contractId" = ${filter.contractId}`);
    if (filter.status?.length)
      conds.push(
        Prisma.sql`p.status IN (${Prisma.join(
          filter.status.map((s) => Prisma.sql`${s}::"PaymentStatus"`),
        )})`,
      );
    if (filter.dueFrom)
      conds.push(Prisma.sql`p."dueDate" >= ${filter.dueFrom}`);
    if (filter.dueTo) conds.push(Prisma.sql`p."dueDate" <= ${filter.dueTo}`);

    const statusDir = Prisma.raw(dir === 'desc' ? 'DESC' : 'ASC');
    const rows = await this.prisma.db.$queryRaw<
      Array<{ id: string }>
    >(Prisma.sql`
      SELECT p.id
      FROM "Payment" p
      JOIN "Contract" c ON c.id = p."contractId"
      JOIN "Client" cl ON cl.id = c."clientId"
      WHERE ${Prisma.join(conds, ' AND ')}
      ORDER BY
        CASE p.status
          WHEN 'OVERDUE' THEN 0
          WHEN 'PENDING' THEN 1
          WHEN 'PAID' THEN 2
          ELSE 3
        END ${statusDir},
        cl.name ASC,
        c.description ASC,
        p."dueDate" ASC
      LIMIT ${filter.take} OFFSET ${filter.skip}
    `);
    return rows.map((r) => r.id);
  }

  async sumByStatus(filter: PaymentBaseFilter) {
    const rows = await this.prisma.db.payment.groupBy({
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
    return this.prisma.db.payment.update({
      where: { id },
      data,
      include: withContract,
    });
  }

  async existsForDueDate(contractId: string, dueDate: Date): Promise<boolean> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const count = await this.admin.payment.count({
      where: { contractId, dueDate },
    });
    return count > 0;
  }

  create(data: Prisma.PaymentUncheckedCreateInput) {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    return this.admin.payment.create({ data, include: withContract });
  }

  async markOverdue(now: Date): Promise<PaymentVencido[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    // Carrega antes de atualizar: `updateMany` só devolve o `count`, e a trilha
    // precisa de uma linha por cobrança (é ela que responde "por que esta
    // cobrança virou OVERDUE"). O SELECT e o UPDATE usam o MESMO filtro; uma
    // cobrança paga entre os dois simplesmente não é atualizada e a trilha teria
    // uma linha a mais — corrida improvável às 3h e sem consequência de negócio.
    const where = { status: 'PENDING' as const, dueDate: { lt: now } };
    const alvos = await this.admin.payment.findMany({
      where,
      select: { id: true, ownerId: true, description: true },
    });
    if (alvos.length === 0) return [];
    await this.admin.payment.updateMany({ where, data: { status: 'OVERDUE' } });
    return alvos;
  }
}
