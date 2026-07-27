import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/notification.repository';
import { NotificationsDispatcherService } from './notifications-dispatcher.service';

/** Teto por rodada. Com 1 rodada por minuto dá vazão de 12k entregas/hora. */
const LOTE = 200;

/**
 * Varredura do outbox. É o mecanismo de dispatch porque **não há hook de
 * post-commit**: o `OwnerContextInterceptor` devolve `from($transaction(...))` e
 * nada roda entre o commit e a resposta. A alternativa seria um `tap()` depois da
 * transação, no arquivo mais crítico do projeto (o mesmo que carrega a ordem dos
 * guards marcada como "não altere"). Job é a escolha barata e reversível.
 *
 * `name:` explícito — os dois crons legados não têm, e a Fase 9 acrescenta três.
 */
@Injectable()
export class NotificationsDispatchJob {
  private readonly logger = new Logger(NotificationsDispatchJob.name);

  constructor(
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
    private readonly dispatcher: NotificationsDispatcherService,
  ) {}

  @Cron('* * * * *', { name: 'notificacoes-dispatch' })
  async run(): Promise<void> {
    const pendentes = await this.repo.findPendentes(new Date(), LOTE);
    if (pendentes.length === 0) return;
    const r = await this.dispatcher.despacharLote(pendentes);
    // Log AGREGADO por lote, com guard > 0 — o padrão dos dois jobs existentes.
    this.logger.log({
      evento: 'notificacao.lote_entregue',
      msg: 'Lote de notificações despachado.',
      quantidade: pendentes.length,
      entregues: r.entregues,
      falhas: r.falhas,
      puladas: r.puladas,
    });
  }
}
