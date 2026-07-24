import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ContactRepository } from '../domain/contact.repository';

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private prisma: PrismaService) {}

  findManyByClient(clientId: string) {
    return this.prisma.db.contact.findMany({
      where: { clientId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  findById(id: string) {
    return this.prisma.db.contact.findUnique({ where: { id } });
  }

  create(data: Prisma.ContactUncheckedCreateInput) {
    return this.prisma.db.contact.create({ data });
  }

  update(id: string, data: Prisma.ContactUpdateInput) {
    return this.prisma.db.contact.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.prisma.db.contact.delete({ where: { id } });
  }

  countByClient(clientId: string) {
    return this.prisma.db.contact.count({ where: { clientId } });
  }

  async clearPrimary(clientId: string, exceptId?: string) {
    await this.prisma.db.contact.updateMany({
      where: {
        clientId,
        isPrimary: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isPrimary: false },
    });
  }
}
