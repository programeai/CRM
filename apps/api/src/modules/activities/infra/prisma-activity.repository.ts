import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ActivityListFilter,
  ActivityRepository,
} from '../domain/activity.repository';

@Injectable()
export class PrismaActivityRepository implements ActivityRepository {
  constructor(private prisma: PrismaService) {}

  async findManyAndCount(filter: ActivityListFilter) {
    const where: Prisma.ActivityWhereInput = {
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.dealId ? { dealId: filter.dealId } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.activity.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.activity.count({ where }),
    ]);
    return { data, total };
  }

  findById(id: string) {
    return this.prisma.db.activity.findUnique({ where: { id } });
  }

  create(data: Prisma.ActivityUncheckedCreateInput) {
    return this.prisma.db.activity.create({ data });
  }

  update(id: string, data: Prisma.ActivityUpdateInput) {
    return this.prisma.db.activity.update({ where: { id }, data });
  }
}
