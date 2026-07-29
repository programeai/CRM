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
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../../notifications/notifications.service';

/** Nome exibido na tela de auditoria para as duas rotinas diárias. */
const ATOR_ROTINA = 'Rotina diária';

@Injectable()
export class FinanceBillingJob {
  private readonly logger = new Logger(FinanceBillingJob.name);

  constructor(
    @Inject(CONTRACT_REPOSITORY) private readonly contracts: ContractRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Rotina financeira diária: gera a mensalidade do mês e vence o que passou do
   * prazo.
   *
   * `timeZone` explícito porque o container roda em UTC (não há `TZ` no compose
   * nem no Dockerfile): `EVERY_DAY_AT_3AM` sozinho é 3h UTC = meia-noite BRT, e
   * uma rotina que decide vencimento POR DATA não deve rodar na virada do dia
   * local — é a hora em que "hoje" é mais ambíguo. Agora roda 3h BRT, como o
   * nome sempre anunciou.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, {
    name: 'financeiro-cobrancas',
    timeZone: 'America/Sao_Paulo',
  })
  async run(): Promise<void> {
    const now = new Date();
    const generated = await this.generateMonthly(now);
    const vencidas = await this.payments.markOverdue(now);
    // Uma linha por cobrança, com o ownerId DA COBRANÇA: o cron é cross-owner e
    // cada owner só pode enxergar as suas.
    for (const p of vencidas) {
      await this.audit.registrarPeloSistema({
        ownerId: p.ownerId,
        actorType: 'CRON',
        actorName: ATOR_ROTINA,
        entity: 'PAYMENT',
        entityId: p.id,
        entityLabel: p.description,
        action: 'VENCER',
        antes: { status: 'PENDING' },
        depois: { status: 'OVERDUE' },
      });
      // Gatilho (d). `notificarPeloSistema` já engole a própria exceção, então
      // não precisa de try/catch aqui — mas a trilha ACIMA também não tem, e é
      // ela que abortaria o lote se falhasse. Não mexa nessa ordem.
      //
      // Idempotência, declarada: o `updateMany` do `markOverdue` commita
      // `PENDING → OVERDUE` ANTES deste loop. Se o processo cair no meio, a
      // reexecução não reencontra nada (o filtro `status: 'PENDING'` já não casa)
      // e as notificações que faltaram se perdem — o mesmo comportamento que a
      // trilha tem desde a Fase 8B. O `dedupeKey` protege o caso oposto: um
      // reprocessamento manual não duplica.
      await this.notifications.notificarPeloSistema({
        ownerId: p.ownerId,
        userId: p.assigneeId ?? p.ownerId,
        dedupeKey: `PAYMENT_OVERDUE:${p.id}`,
        evento: {
          tipo: 'PAYMENT_OVERDUE',
          entityId: p.id,
          descricao: p.description,
          clienteNome: p.clienteNome,
          valor: p.amount,
          dataAlvo: p.dueDate,
        },
      });
    }
    if (generated > 0) {
      this.logger.log({
        evento: 'financeiro.mensalidades_geradas',
        msg: 'Mensalidades geradas pela rotina diária.',
        quantidade: generated,
      });
    }
    if (vencidas.length > 0) {
      this.logger.log({
        evento: 'financeiro.cobrancas_vencidas',
        msg: 'Cobranças marcadas como vencidas pela rotina diária.',
        quantidade: vencidas.length,
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
        const criado = await this.payments.create({
          ownerId: c.ownerId,
          contractId: c.id,
          description: `Mensalidade ${mm}/${yyyy}`,
          amount: c.monthlyAmount as unknown as number, // valor VIGENTE (reajuste vale p/ futuras)
          dueDate,
          status: 'PENDING',
        });
        await this.audit.registrarPeloSistema({
          ownerId: c.ownerId,
          actorType: 'CRON',
          actorName: ATOR_ROTINA,
          entity: 'PAYMENT',
          entityId: criado.id,
          entityLabel: criado.description,
          action: 'CRIAR',
          extra: { contratoId: c.id, vencimento: dueDate.toISOString() },
        });
        count++;
      }
    }
    return count;
  }
}
