import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AuditService } from '../../audit/audit.service';
import { BillingService } from '../../billing/application/billing.service';
import {
  ACCOUNT_PURGE_REPOSITORY,
  type AccountPurgeRepository,
} from '../domain/account-purge.repository';

/**
 * Duas varreduras diárias sobre `User`, ambas fora de qualquer request:
 *
 *  1. **Cancelamento pendente** — quem pediu o encerramento e ainda tem
 *     assinatura renovável recebe `cancel_at_period_end` no Stripe. Mora aqui, e
 *     não na rota, porque é I/O de rede e o handler autenticado roda dentro da
 *     `$transaction` do `OwnerContextInterceptor`.
 *  2. **Expurgo** — quem venceu a carência é apagado.
 *
 * O `AuditService.registrarPeloSistema` é o caminho certo: engole a própria
 * falha, porque uma trilha que falha não pode abortar o lote de N owners.
 */
@Injectable()
export class AccountPurgeJob {
  private readonly logger = new Logger(AccountPurgeJob.name);

  constructor(
    @Inject(ACCOUNT_PURGE_REPOSITORY)
    private readonly repo: AccountPurgeRepository,
    private readonly billing: BillingService,
    private readonly audit: AuditService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_5AM, { name: 'conta-expurgo' })
  async run(): Promise<void> {
    await this.marcarCancelamentos();
    await this.expurgarVencidos();
  }

  private async marcarCancelamentos(): Promise<void> {
    for (const ownerId of await this.repo.pendentesDeCancelamento()) {
      try {
        if (await this.billing.agendarCancelamentoPorEncerramento(ownerId)) {
          this.logger.log({
            evento: 'conta.assinatura_marcada_para_nao_renovar',
            msg: 'Assinatura marcada para não renovar por encerramento pedido.',
            ownerId,
          });
        }
      } catch (erro) {
        // Falha no Stripe não impede nada: a varredura de amanhã tenta de novo,
        // e o expurgo só prossegue com o cancelamento confirmado.
        this.logger.error(
          {
            evento: 'conta.cancelamento_de_assinatura_falhou',
            msg: 'Falha ao marcar a assinatura para não renovar.',
            ownerId,
          },
          erro instanceof Error ? erro.stack : undefined,
        );
      }
    }
  }

  private async expurgarVencidos(): Promise<void> {
    const vencidos = await this.repo.vencidos(new Date());
    for (const { id: ownerId, deletionRequestedAt } of vencidos) {
      const inicio = Date.now();
      try {
        // ANTES da transação, e é requisito: `onDelete: Cascade` apaga a linha
        // local `Subscription`, mas nada cancela o objeto remoto. Sem isto o
        // Stripe continuaria cobrando um cliente apagado, e todo evento futuro
        // daquele customer viraria webhook órfão (o `stripeCustomerId` some com o
        // `User`, e o repositório passa a devolver `null` em silêncio).
        //
        // Se falhar, este owner é PULADO — nunca apagado com assinatura viva.
        await this.billing.cancelarAgoraPorExpurgo(ownerId);
      } catch (erro) {
        this.logger.error(
          {
            evento: 'conta.expurgo_adiado',
            msg: 'Expurgo adiado: falha ao cancelar a assinatura no Stripe.',
            ownerId,
          },
          erro instanceof Error ? erro.stack : undefined,
        );
        continue;
      }

      const linhas = await this.repo.expurgar(ownerId);

      // DEPOIS do commit, de propósito: a transação acima apagou toda a trilha
      // deste owner, e esta linha é a única que sobrevive. Sem PII nenhuma — só
      // contagens e datas. É também o registro que o runbook de restore consulta
      // para reaplicar exclusões (ver docs/deploy.md).
      await this.audit.registrarPeloSistema({
        ownerId,
        actorType: 'CRON',
        actorName: 'Rotina diária',
        entity: 'ACCOUNT',
        entityId: ownerId,
        entityLabel: 'Conta encerrada',
        action: 'EXPURGAR',
        extra: {
          pedidoEm: deletionRequestedAt.toISOString(),
          linhasPorTabela: linhas,
        },
      });
      this.logger.warn({
        evento: 'conta.expurgada',
        msg: 'Conta e workspace apagadas em definitivo pela rotina diária.',
        ownerId,
        linhas: Object.values(linhas).reduce((a, b) => a + b, 0),
        ms: Date.now() - inicio,
      });
    }
  }
}
