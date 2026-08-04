import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  OWNER_WEBHOOK_REPOSITORY,
  type OwnerWebhookRepository,
} from '../domain/owner-webhook.repository';
import { OwnerWebhooksDispatcherService } from './owner-webhooks-dispatcher.service';

/** Teto por rodada. Com 1 rodada por minuto dá vazão de 12k entregas/hora. */
const LOTE = 200;

/**
 * Varredura da outbox de webhooks do owner. Mesmo mecanismo do outbox de
 * notificações e pela mesma razão: **não há hook de post-commit** no projeto, e a
 * entrega é I/O de rede, que não cabe na transação de 5s do request.
 *
 * A diferença é a reserva do lote — esta outbox usa `FOR UPDATE SKIP LOCKED`
 * (ver `PrismaOwnerWebhookRepository.reservarPendentes`), então ela já está
 * correta se o deploy passar a ter réplicas.
 */
@Injectable()
export class OwnerWebhooksDispatchJob {
  private readonly logger = new Logger(OwnerWebhooksDispatchJob.name);

  constructor(
    @Inject(OWNER_WEBHOOK_REPOSITORY)
    private readonly repo: OwnerWebhookRepository,
    private readonly dispatcher: OwnerWebhooksDispatcherService,
  ) {}

  @Cron('* * * * *', { name: 'webhooks-owner-dispatch' })
  async run(): Promise<void> {
    const pendentes = await this.repo.reservarPendentes(new Date(), LOTE);
    if (pendentes.length === 0) return;
    const r = await this.dispatcher.despacharLote(pendentes);
    // Log AGREGADO por lote, com guard > 0 — o padrão dos jobs existentes.
    this.logger.log({
      evento: 'webhook.lote_entregue',
      msg: 'Lote de eventos de webhook despachado.',
      quantidade: pendentes.length,
      entregues: r.entregues,
      falhas: r.falhas,
      puladas: r.puladas,
    });
  }
}
