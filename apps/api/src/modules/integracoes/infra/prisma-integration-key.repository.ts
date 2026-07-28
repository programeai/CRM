import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  IntegrationKeyRecord,
  IntegrationKeyRepository,
} from '../domain/integration-key.repository';

/** `keyHash` fica FORA de todo `select`: o que não sai do banco não vaza. */
const CAMPOS = {
  id: true,
  ownerId: true,
  name: true,
  prefix: true,
  scopes: true,
  lastUsedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class PrismaIntegrationKeyRepository implements IntegrationKeyRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  findManyByOwner(ownerId: string): Promise<IntegrationKeyRecord[]> {
    return this.prisma.db.integrationKey.findMany({
      where: { ownerId },
      select: CAMPOS,
      orderBy: { createdAt: 'asc' },
    });
  }

  findById(ownerId: string, id: string) {
    return this.prisma.db.integrationKey.findFirst({
      where: { id, ownerId },
      select: CAMPOS,
    });
  }

  create(data: {
    ownerId: string;
    name: string;
    keyHash: string;
    prefix: string;
    scopes: string[];
  }) {
    return this.prisma.db.integrationKey.create({ data, select: CAMPOS });
  }

  replaceSecret(
    ownerId: string,
    id: string,
    data: { keyHash: string; prefix: string },
  ) {
    return this.prisma.db.integrationKey.update({
      where: { id },
      data: { ...data, lastUsedAt: null, revokedAt: null },
      select: CAMPOS,
    });
  }

  revoke(ownerId: string, id: string) {
    return this.prisma.db.integrationKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: CAMPOS,
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.integrationKey.delete({ where: { id } });
  }

  async touch(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.integrationKey.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  /**
   * Autenticação: roda ANTES de qualquer `app.owner_id` (é ela que descobre
   * qual owner é), então `IntegrationKey` — que tem RLS — só é visível pelo
   * client admin. Precedente: `AccessService` e `prisma-invite.repository.ts`.
   */
  findByHashPeloSistema(keyHash: string) {
    return this.admin.integrationKey.findUnique({
      where: { keyHash },
      select: CAMPOS,
    });
  }
}
