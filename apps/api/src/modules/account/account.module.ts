import { Module } from '@nestjs/common';
import { MailModule } from '../../mail/mail.module';
import { BillingModule } from '../billing/billing.module';
import { AccountController } from './api/account.controller';
import { AccountExportService } from './application/account-export.service';
import { AccountDeletionService } from './application/account-deletion.service';
import { AccountPurgeJob } from './application/account-purge.job';
import { ACCOUNT_DUMP_REPOSITORY } from './domain/account-dump.repository';
import { PrismaAccountDumpRepository } from './infra/prisma-account-dump.repository';
import { ACCOUNT_REPOSITORY } from './domain/account.repository';
import { PrismaAccountRepository } from './infra/prisma-account.repository';
import { ACCOUNT_PURGE_REPOSITORY } from './domain/account-purge.repository';
import { PrismaAccountPurgeRepository } from './infra/prisma-account-purge.repository';

/**
 * Os direitos do titular sobre a própria conta: portabilidade (19-A) e
 * encerramento. Não tem tabela própria — opera sobre `User` e sobre as tabelas
 * de negócio dos outros módulos, e é o único módulo autorizado a atravessar
 * essa fronteira, porque é o único cuja unidade de trabalho É a workspace.
 *
 * AuditModule é @Global() (ver app.module.ts) — AuditService chega sem import.
 */
@Module({
  imports: [MailModule, BillingModule],
  controllers: [AccountController],
  providers: [
    AccountExportService,
    AccountDeletionService,
    AccountPurgeJob,
    { provide: ACCOUNT_DUMP_REPOSITORY, useClass: PrismaAccountDumpRepository },
    { provide: ACCOUNT_REPOSITORY, useClass: PrismaAccountRepository },
    {
      provide: ACCOUNT_PURGE_REPOSITORY,
      useClass: PrismaAccountPurgeRepository,
    },
  ],
})
export class AccountModule {}
