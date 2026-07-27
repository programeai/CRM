import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import type { Request } from 'express';
import { PrismaModule } from './prisma/prisma.module';
import { OwnerContextInterceptor } from './prisma/owner-context.interceptor';
import { AccessModule } from './modules/access/access.module';
import { AccessGuard } from './modules/access/access.guard';
import { AuditModule } from './modules/audit/audit.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { AuthModule } from './modules/auth/auth.module';
import { CollaboratorsModule } from './modules/collaborators/collaborators.module';
import { WorkspaceModule } from './modules/workspace/workspace.module';
import { CatalogosModule } from './modules/catalogos/catalogos.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { TrashModule } from './modules/trash/trash.module';
import { BillingModule } from './modules/billing/billing.module';
import { HealthModule } from './modules/health/health.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { BillingGuard } from './modules/billing/billing.guard';
import { envValidationSchema } from './config/env.validation';
import { AllExceptionsFilter } from './shared/logging/all-exceptions.filter';
import { CABECALHO_REQUEST_ID } from './shared/logging/request-context.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    ScheduleModule.forRoot(),
    // generateId + idGenerator: o id do contexto CLS é o mesmo `x-request-id`
    // que o `contextoDaRequisicao` (middleware Express, roda antes) colocou na
    // requisição e devolveu na resposta. É o que amarra as linhas de log de um
    // acesso, do log de acesso até o último log de service.
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: Request) =>
          req.headers[CABECALHO_REQUEST_ID]?.toString() ?? '',
      },
    }),
    PrismaModule,
    AccessModule,
    AuditModule,
    NotificationsModule, // ← @Global(), junto do AuditModule pelo mesmo motivo
    AuthModule,
    CollaboratorsModule,
    WorkspaceModule,
    CatalogosModule,
    ClientsModule,
    ContactsModule,
    ActivitiesModule,
    PipelineModule,
    ProposalsModule,
    ProjectsModule,
    FinanceModule,
    DashboardModule,
    TrashModule,
    BillingModule,
    HealthModule,
  ],
  providers: [
    // Registra e responde qualquer exceção que chegue à borda HTTP (ver o filtro).
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Após o JwtAuthGuard: usa req.user para resolver req.access (workspace +
    // permissões) e aplicar o @RequirePermission da rota.
    { provide: APP_GUARD, useClass: AccessGuard },
    // Após o AccessGuard: o gate é da assinatura do OWNER da workspace, que só
    // o req.access conhece (colaborador não tem assinatura própria).
    { provide: APP_GUARD, useClass: BillingGuard },
    { provide: APP_INTERCEPTOR, useClass: OwnerContextInterceptor },
  ],
})
export class AppModule {}
