import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannelKind } from '@prisma/client';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';
import { postar } from './webhook.channel';

/**
 * Escape do *mrkdwn* do Slack. São exatamente **três** caracteres, e só eles: o
 * Slack pede `&`, `<` e `>` escapados e trata o resto como texto.
 * https://api.slack.com/reference/surfaces/formatting#escaping
 */
export function escaparMrkdwn(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Canal do Slack. Mesmo transporte do webhook genérico — o que muda é **só o
 * formato do corpo**, que é exatamente o ponto da terceira costura: um serviço
 * novo é um arquivo em `infra/` e uma linha no `inject` do módulo.
 *
 * Existe separado do `WebhookChannel` porque o Slack **não** aceita corpo
 * arbitrário: ele quer `{ text }`. Um canal genérico apontado para o Slack não
 * renderiza nada.
 */
@Injectable()
export class SlackChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'SLACK';

  constructor(private readonly config: ConfigService) {}

  isEnabled(): boolean {
    return true;
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { url } = destino.config as { url?: string };
    if (!url) throw new Error('Destino do Slack sem URL configurada.');

    const linhas = [
      `*${escaparMrkdwn(conteudo.titulo)}*`,
      escaparMrkdwn(conteudo.corpo),
    ];
    // O `link` vem relativo do core (é ele que não conhece o host público) — o
    // adapter prefixa, como faz o template de e-mail.
    const appUrl = (this.config.get<string>('FRONTEND_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    if (conteudo.link && appUrl) {
      linhas.push(`<${appUrl}${conteudo.link}|Abrir no CRM>`);
    }

    await postar(url, { text: linhas.join('\n') }, conteudo.deliveryId);
  }
}
