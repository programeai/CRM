import { Inject, Injectable, Logger } from '@nestjs/common';
import { proximaTentativa } from '../../../shared/backoff';
import { postar } from '../../../shared/webhook-post';
import {
  OWNER_WEBHOOK_REPOSITORY,
  type OwnerWebhookRepository,
  type PendingWebhookDelivery,
} from '../domain/owner-webhook.repository';

export interface ResultadoDoLote {
  entregues: number;
  falhas: number;
  puladas: number;
}

@Injectable()
export class OwnerWebhooksDispatcherService {
  private readonly logger = new Logger(OwnerWebhooksDispatcherService.name);

  constructor(
    @Inject(OWNER_WEBHOOK_REPOSITORY)
    private readonly repo: OwnerWebhookRepository,
  ) {}

  /**
   * Entrega um lote. `Promise.allSettled`: um endereço que falha não derruba os
   * outros — nem os do mesmo owner, nem os dos outros owners do lote.
   */
  async despacharLote(
    pendentes: PendingWebhookDelivery[],
  ): Promise<ResultadoDoLote> {
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
    p: PendingWebhookDelivery,
  ): Promise<'SENT' | 'SKIPPED' | 'FAILED'> {
    /*
      O webhook pode ter sido desativado ENTRE a emissão e a entrega. Desistir é
      o comportamento certo: quem desligou o webhook não quer que o que já estava
      na fila continue saindo da workspace.
    */
    if (!p.active) {
      await this.repo.marcarFalha(
        p.id,
        p.attempts,
        null,
        'Webhook desativado antes da entrega.',
      );
      return 'SKIPPED';
    }

    try {
      await postar(p.url, p.payload, p.id, p.secret);
      await this.repo.marcarEnviada(p.id, new Date());
      // `lastUsedAt` do webhook responde "este endereço ainda está vivo?" na
      // tela — por isso é marcado só no SUCESSO, e depois da entrega.
      await this.repo.touchPeloSistema(p.webhookId);
      return 'SENT';
    } catch (erro) {
      const attempts = p.attempts + 1;
      // `null` = esgotou o backoff: FAILED definitivo.
      const proxima = proximaTentativa(attempts, new Date());
      await this.repo.marcarFalha(p.id, attempts, proxima, this.mensagem(erro));
      // Sem payload, URL nem segredo no log — o Grafana é público.
      this.logger.error({
        evento: 'webhook.entrega_falhou',
        msg: 'Falha ao entregar evento num webhook do owner.',
        entregaId: p.id,
        tipo: p.event,
        tentativa: attempts,
        definitiva: proxima === null,
      });
      return 'FAILED';
    }
  }

  /**
   * Trunca em 500: `lastError` é diagnóstico, não dump. A mensagem que chega
   * aqui nunca carrega URL nem segredo — quem a monta é `shared/webhook-post.ts`,
   * que só põe o status HTTP.
   */
  private mensagem(erro: unknown): string {
    return (erro instanceof Error ? erro.message : String(erro)).slice(0, 500);
  }
}
