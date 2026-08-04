import { Module } from '@nestjs/common';
import { RetentionJob } from './application/retention.job';
import { RETENTION_REPOSITORY } from './domain/retention.repository';
import { PrismaRetentionRepository } from './infra/prisma-retention.repository';

/**
 * Faxina de retenção. Não expõe rota nem service: é um cron e um repositório, e os
 * prazos são constantes de `domain/retencao.ts` — não há o que configurar, por
 * decisão (ver o docblock de lá).
 */
@Module({
  providers: [
    RetentionJob,
    { provide: RETENTION_REPOSITORY, useClass: PrismaRetentionRepository },
  ],
})
export class RetentionModule {}
