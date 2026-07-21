import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ContactRepository } from '../domain/contact.repository';

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private prisma: PrismaService) {}

  findManyByClient(clientId: string) {
    return this.prisma.contact.findMany({
      where: { clientId },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  findById(id: string) {
    return this.prisma.contact.findUnique({ where: { id } });
  }

  create(data: Prisma.ContactUncheckedCreateInput) {
    return this.prisma.contact.create({ data });
  }

  update(id: string, data: Prisma.ContactUpdateInput) {
    return this.prisma.contact.update({ where: { id }, data });
  }

  async delete(id: string) {
    await this.prisma.contact.delete({ where: { id } });
  }

  countByClient(clientId: string) {
    return this.prisma.contact.count({ where: { clientId } });
  }

  async clearPrimary(clientId: string, exceptId?: string) {
    await this.prisma.contact.updateMany({
      where: {
        clientId,
        isPrimary: true,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isPrimary: false },
    });
  }
}
