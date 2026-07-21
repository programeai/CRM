import type { Activity, Prisma } from '@prisma/client';

export const ACTIVITY_REPOSITORY = Symbol('ACTIVITY_REPOSITORY');

export interface ActivityListFilter {
  clientId?: string;
  dealId?: string;
  skip: number;
  take: number;
}

export interface ActivityRepository {
  findManyAndCount(
    filter: ActivityListFilter,
  ): Promise<{ data: Activity[]; total: number }>;
  findById(id: string): Promise<Activity | null>;
  create(data: Prisma.ActivityUncheckedCreateInput): Promise<Activity>;
  update(id: string, data: Prisma.ActivityUpdateInput): Promise<Activity>;
}
