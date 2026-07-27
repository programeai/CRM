import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { ContactRepository } from '../domain/contact.repository';
import { ATIVO, ativoWhere } from '../../../shared/soft-delete';

@Injectable()
export class PrismaContactRepository implements ContactRepository {
  constructor(private prisma: PrismaService) {}

  findManyByClient(clientId: string) {
    return this.prisma.db.contact.findMany({
      where: { clientId, ...ATIVO },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    });
  }

  findById(id: string, includeArchived = false) {
    // findFirst (não findUnique): o soft delete faz parte da busca.
    return this.prisma.db.contact.findFirst({
      where: { id, ...ativoWhere(includeArchived) },
    });
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

  archive(id: string) {
    return this.prisma.db.contact.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }

  restore(id: string) {
    return this.prisma.db.contact.update({
      where: { id },
      data: { archivedAt: null },
    });
  }

  countByClient(clientId: string) {
    // Um contato arquivado não deve contar como "primeiro contato" do cliente.
    return this.prisma.db.contact.count({ where: { clientId, ...ATIVO } });
  }

  async clearPrimary(clientId: string, exceptId?: string) {
    // Um contato arquivado não deve ser rebaixado de principal (já não conta como um).
    await this.prisma.db.contact.updateMany({
      where: {
        clientId,
        isPrimary: true,
        ...ATIVO,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      data: { isPrimary: false },
    });
  }
}
