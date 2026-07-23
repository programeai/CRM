import { Module } from '@nestjs/common';
import { ClientsModule } from '../clients/clients.module';
import { ContractsController } from './api/contracts.controller';
import { PaymentsController } from './api/payments.controller';
import { ContractsService } from './application/contracts.service';
import { PaymentsService } from './application/payments.service';
import { FinanceBillingJob } from './application/finance-billing.job';
import { CONTRACT_REPOSITORY } from './domain/contract.repository';
import { PAYMENT_REPOSITORY } from './domain/payment.repository';
import { PrismaContractRepository } from './infra/prisma-contract.repository';
import { PrismaPaymentRepository } from './infra/prisma-payment.repository';

@Module({
  imports: [ClientsModule],
  controllers: [ContractsController, PaymentsController],
  providers: [
    ContractsService,
    PaymentsService,
    FinanceBillingJob,
    { provide: CONTRACT_REPOSITORY, useClass: PrismaContractRepository },
    { provide: PAYMENT_REPOSITORY, useClass: PrismaPaymentRepository },
  ],
  exports: [ContractsService], // consumido pela ficha do cliente / costura de aceite
})
export class FinanceModule {}
