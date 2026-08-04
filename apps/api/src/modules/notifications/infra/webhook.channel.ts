import { Injectable } from '@nestjs/common';
import type { NotificationChannelKind } from '@prisma/client';
import { postar } from '../../../shared/webhook-post';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';

/*
  O transporte (`postar`, `postarLendoResposta`, `TIMEOUT_MS`) subiu para
  `shared/webhook-post.ts` na Fase 19-B, quando o webhook de saída do owner
  passou a precisar do mesmo POST: duplicá-lo faria as duas outboxes divergirem
  em timeout, cabeçalho e forma da assinatura — que é justamente o que um
  receptor não pode adivinhar. Os reexports abaixo existem para os outros canais
  (`slack`, `discord`, `telegram`) e os specs continuarem importando daqui.
*/
export {
  postar,
  postarLendoResposta,
  TIMEOUT_MS,
} from '../../../shared/webhook-post';

/**
 * Canal de webhook genérico: POSTa o **conteúdo neutro cru**, para quem consome
 * com n8n/Zapier montar o que quiser do outro lado.
 *
 * `X-CRM-Delivery` é o que deixa o receptor **deduplicar** — necessário, porque
 * o outbox tem retry e a mesma entrega pode chegar duas vezes.
 *
 * **A assinatura é ADITIVA** (issue #26, Fase 19-B): destino com `config.secret`
 * recebe `X-CRM-Signature`; destino sem segredo — Slack, Discord, Telegram, e
 * todo webhook cadastrado antes da 19-B — entrega exatamente como antes. Isso é
 * o que permitiu esperar sem gerar dívida de compatibilidade.
 *
 * A assinatura protege o RECEPTOR contra corpo forjado. Ela **não** substitui a
 * trava de `shared/webhook-url.ts`, que é o que defende a workspace contra
 * exfiltração — ver o docblock de lá.
 */
@Injectable()
export class WebhookChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'WEBHOOK';

  /** Não depende de config de ambiente: a URL vem do destino do usuário. */
  isEnabled(): boolean {
    return true;
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { url, secret } = destino.config as {
      url?: string;
      secret?: string;
    };
    if (!url) throw new Error('Destino de webhook sem URL configurada.');
    await postar(url, this.corpo(conteudo), conteudo.deliveryId, secret);
  }

  /** O conteúdo neutro, cru. Nenhum formato de serviço específico aqui. */
  protected corpo(conteudo: ConteudoDeNotificacao): unknown {
    return {
      tipo: conteudo.tipo,
      titulo: conteudo.titulo,
      corpo: conteudo.corpo,
      link: conteudo.link,
      dados: conteudo.dados,
    };
  }
}
