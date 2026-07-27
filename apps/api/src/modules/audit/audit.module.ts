import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryService } from './application/audit-query.service';
import { AuditController } from './api/audit.controller';
import { AUDIT_REPOSITORY } from './domain/audit.repository';
import { PrismaAuditRepository } from './infra/prisma-audit.repository';

/**
 * Global de propósito: a **escrita** da trilha é transversal e cruza módulos que
 * não têm (nem devem ter) dependência entre si — finance, proposals,
 * collaborators, clients. Importar `AuditModule` em cada um deles seria ruído
 * sem ganho de fronteira.
 *
 * Exporta **só** o `AuditService`: a leitura (controller + repositório) é
 * assunto interno deste módulo.
 */
@Global()
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditQueryService,
    { provide: AUDIT_REPOSITORY, useClass: PrismaAuditRepository },
  ],
  exports: [AuditService],
})
export class AuditModule {}
