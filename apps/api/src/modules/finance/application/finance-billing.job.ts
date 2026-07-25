import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  CONTRACT_REPOSITORY,
  type ContractRepository,
} from '../domain/contract.repository';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../domain/payment.repository';
import { billingDatesInWindow } from './schedule';

@Injectable()
export class FinanceBillingJob {
  private readonly logger = new Logger(FinanceBillingJob.name);

  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async run(): Promise<void> {
    const now = new Date();
    const generated = await this.generateMonthly(now);
    const overdue = await this.payments.markOverdue(now);
    if (generated > 0) {
      this.logger.log({
        evento: 'financeiro.mensalidades_geradas',
        msg: 'Mensalidades geradas pela rotina diária.',
        quantidade: generated,
      });
    }
    if (overdue > 0) {
      this.logger.log({
        evento: 'financeiro.cobrancas_vencidas',
        msg: 'Cobranças marcadas como vencidas pela rotina diária.',
        quantidade: overdue,
      });
    }
  }

  /** Gera as mensalidades cujo vencimento cai na janela (now, now+30d], se ainda não existirem. */
  private async generateMonthly(now: Date): Promise<number> {
    const horizon = new Date(now);
    horizon.setDate(horizon.getDate() + 30);
    const active = await this.contracts.findActiveRecurring();
    let count = 0;
    for (const c of active) {
      if (c.billingDay == null || c.startDate == null) continue;
      const dates = billingDatesInWindow(
        {
          billingDay: c.billingDay,
          startDate: c.startDate,
          endDate: c.endDate ?? null,
        },
        now,
        horizon,
      );
      for (const dueDate of dates) {
        if (await this.payments.existsForDueDate(c.id, dueDate)) continue; // idempotente
        const mm = String(dueDate.getMonth() + 1).padStart(2, '0');
        const yyyy = dueDate.getFullYear();
        await this.payments.create({
          ownerId: c.ownerId,
          contractId: c.id,
          description: `Mensalidade ${mm}/${yyyy}`,
          amount: c.monthlyAmount as unknown as number, // valor VIGENTE (reajuste vale p/ futuras)
          dueDate,
          status: 'PENDING',
        });
        count++;
      }
    }
    return count;
  }
}
