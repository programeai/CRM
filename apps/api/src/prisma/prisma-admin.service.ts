import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

/**
 * Client privilegiado, conectado como crm_user (superuser → bypassa RLS).
 * Uso restrito a operações sem contexto de owner: crons cross-owner e seed.
 * Não expõe `.db`/CLS — nunca deve ser usado no caminho de requisição HTTP.
 */
@Injectable()
export class PrismaAdminService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      datasources: { db: { url: config.getOrThrow<string>('DATABASE_URL') } },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
