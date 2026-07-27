import { Inject, Injectable, Logger } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import {
  NOTIFICATION_CHANNELS,
  type CanalDeNotificacao,
} from '../domain/notification-channel';
import {
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
  type PendingDelivery,
} from '../domain/notification.repository';

/** Espera entre tentativas, em minutos. O tamanho do array é o MÁXIMO de tentativas. */
const BACKOFF_MIN = [1, 5, 30, 120, 480];

export interface ResultadoDoLote {
  entregues: number;
  falhas: number;
  puladas: number;
}

@Injectable()
export class NotificationsDispatcherService {
  private readonly logger = new Logger(NotificationsDispatcherService.name);
  private readonly registry: Map<NotificationChannelKind, CanalDeNotificacao>;

  constructor(
    @Inject(NOTIFICATION_CHANNELS) canais: CanalDeNotificacao[],
    @Inject(NOTIFICATION_REPOSITORY)
    private readonly repo: NotificationRepository,
  ) {
    this.registry = new Map(canais.map((c) => [c.kind, c]));
  }

  /**
   * Entrega um lote. `Promise.allSettled`: um destino que falha não derruba os
   * outros — nem os do mesmo usuário, nem os dos outros owners do lote.
   */
  async despacharLote(pendentes: PendingDelivery[]): Promise<ResultadoDoLote> {
    const r: ResultadoDoLote = { entregues: 0, falhas: 0, puladas: 0 };
    const resultados = await Promise.allSettled(
      pendentes.map((p) => this.despachar(p)),
    );
    for (const res of resultados) {
      if (res.status === 'rejected') {
        r.falhas++;
        continue;
      }
      if (res.value === 'SENT') r.entregues++;
      else if (res.value === 'SKIPPED') r.puladas++;
      else r.falhas++;
    }
    return r;
  }

  private async despachar(
    p: PendingDelivery,
  ): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
    const canal = this.registry.get(p.kind);
    if (!canal) {
      await this.repo.marcarPulada(p.id, 'Canal não registrado.');
      return 'SKIPPED';
    }
    if (!canal.isEnabled()) {
      await this.repo.marcarPulada(
        p.id,
        'Canal desabilitado por configuração.',
      );
      return 'SKIPPED';
    }
    if (!p.target) {
      // O destino foi apagado depois da emissão (FK é SET NULL).
      await this.repo.marcarPulada(p.id, 'Destino removido.');
      return 'SKIPPED';
    }

    try {
      await canal.entregar(
        { id: p.target.id, kind: p.target.kind, config: p.target.config },
        {
          tipo: p.notification.type,
          titulo: p.notification.title,
          corpo: p.notification.body,
          link: p.notification.link,
          dados: p.notification.data as Record<string, unknown> | null,
          deliveryId: p.id,
        },
      );
      await this.repo.marcarEnviada(p.id, new Date());
      return 'SENT';
    } catch (erro) {
      const attempts = p.attempts + 1;
      const espera = BACKOFF_MIN[attempts - 1];
      const proxima =
        espera == null
          ? null // esgotou: FAILED definitivo
          : new Date(Date.now() + espera * 60_000);
      await this.repo.marcarFalha(p.id, attempts, proxima, this.mensagem(erro));
      // Sem título/corpo/config no log — o Grafana é público.
      this.logger.error({
        evento: 'notificacao.entrega_falhou',
        msg: 'Falha ao entregar notificação num destino.',
        canal: p.kind,
        entregaId: p.id,
        tentativa: attempts,
        definitiva: proxima === null,
      });
      return 'FAILED';
    }
  }

  /** Trunca em 500: `lastError` é diagnóstico, não dump. */
  private mensagem(erro: unknown): string {
    return (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
  }
}
