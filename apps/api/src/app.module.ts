import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { ClsModule } from 'nestjs-cls';
import { PrismaModule } from './prisma/prisma.module';
import { OwnerContextInterceptor } from './prisma/owner-context.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { FinanceModule } from './modules/finance/finance.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { BillingModule } from './modules/billing/billing.module';
import { JwtAuthGuard } from './modules/auth/jwt-auth.guard';
import { BillingGuard } from './modules/billing/billing.guard';
import { envValidationSchema } from './config/env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
    }),
    ThrottlerModule.forRoot({ throttlers: [{ ttl: 60000, limit: 100 }] }),
    ScheduleModule.forRoot(),
    ClsModule.forRoot({ global: true, middleware: { mount: true } }),
    PrismaModule,
    AuthModule,
    ClientsModule,
    ContactsModule,
    ActivitiesModule,
    PipelineModule,
    ProposalsModule,
    ProjectsModule,
    FinanceModule,
    DashboardModule,
    BillingModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Após o JwtAuthGuard: precisa de req.user para identificar o owner.
    { provide: APP_GUARD, useClass: BillingGuard },
    { provide: APP_INTERCEPTOR, useClass: OwnerContextInterceptor },
  ],
})
export class AppModule {}
