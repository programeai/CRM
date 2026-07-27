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
 * Teto do `content` no Discord (doc oficial). Truncar é defensivo: o nosso texto
 * é curto, mas `corpo` interpola nome de cliente, que é entrada do usuário — e um
 * 400 por corpo grande queimaria as seis tentativas do outbox de graça.
 */
export const MAX_CONTENT = 2000;

/**
 * Escape do markdown do Discord. São caracteres DIFERENTES dos do Slack (que
 * pede `&`, `<`, `>`): aqui o que causa formatação acidental é `* _ ~ | ` \`.
 * A barra invertida vem primeiro, senão escaparíamos as barras que acabamos de
 * inserir.
 */
export function escaparMarkdown(texto: string): string {
  return texto.replace(/([\\*_~`|])/g, '\\$1');
}

/**
 * Canal do Discord. Mesmo transporte do webhook genérico — o que muda é **só o
 * formato do corpo**, que é exatamente o ponto da terceira costura da Fase 9.
 *
 * Existe separado do `WebhookChannel` pela mesma razão do `SlackChannel`: o
 * Discord quer `{ content }` e ignora corpo arbitrário, então um canal genérico
 * apontado para cá não renderiza nada.
 *
 * O link vai **entre `< >`**: assim ele é clicável e o Discord não tenta montar
 * card de preview (que aqui seria inútil — a URL do CRM exige sessão). Link
 * mascarado `[label](url)` foi avaliado e recusado: o suporte fora de embeds é
 * contestado, e quando falha o usuário vê os colchetes crus.
 */
@Injectable()
export class DiscordChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'DISCORD';

  constructor(private readonly config: ConfigService) {}

  /** Não depende de config de ambiente: a URL vem do destino do usuário. */
  isEnabled(): boolean {
    return true;
  }

  async entregar(
    destino: DestinoDeNotificacao,
    conteudo: ConteudoDeNotificacao,
  ): Promise<void> {
    const { url } = destino.config as { url?: string };
    if (!url) throw new Error('Destino do Discord sem URL configurada.');

    const linhas = [
      `**${escaparMarkdown(conteudo.titulo)}**`,
      escaparMarkdown(conteudo.corpo),
    ];
    // O `link` vem relativo do core (é ele que não conhece o host público) — o
    // adapter prefixa, como o template de e-mail e o canal do Slack já fazem.
    const appUrl = (this.config.get<string>('FRONTEND_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    if (conteudo.link && appUrl) {
      linhas.push(`<${appUrl}${conteudo.link}>`);
    }

    await postar(
      url,
      { content: linhas.join('\n').slice(0, MAX_CONTENT) },
      conteudo.deliveryId,
    );
  }
}
