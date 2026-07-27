import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NotificationChannelKind } from '@prisma/client';
import type {
  CanalDeNotificacao,
  ConteudoDeNotificacao,
  DestinoDeNotificacao,
} from '../domain/notification-channel';
import { postarLendoResposta } from './webhook.channel';

/**
 * Teto do `text` no `sendMessage`. Valor consagrado da Bot API — a doc oficial
 * trunca antes da tabela de parâmetros e não deu para citá-la, então isto NÃO é
 * um fato verificado como os outros deste arquivo. O risco é contido: se o teto
 * real fosse menor, o Telegram devolveria erro e o `entregar` rejeitaria (não
 * passaria em silêncio), porque este canal lê o corpo da resposta.
 */
export const MAX_TEXT = 4096;

/**
 * Escape do modo HTML. São os mesmos três caracteres do Slack, e por um motivo
 * estrutural: `&`, `<` e `>` são os únicos que podem abrir uma tag ou uma
 * entidade. Escapar exatamente eles é o mínimo suficiente **e** o máximo útil —
 * não há como sobre-escapar aqui.
 *
 * O modo HTML foi escolhido no lugar do MarkdownV2 de propósito: o MarkdownV2
 * exige escapar quase vinte caracteres, e um só esquecido derruba a mensagem
 * inteira com erro de parse. Nome de cliente é entrada do usuário.
 */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Extrai o `chat_id` da query da URL e devolve a URL **sem** a query.
 *
 * O front monta `https://api.telegram.org/bot<TOKEN>/sendMessage?chat_id=<ID>`
 * porque a `config` do destino guarda só `{ url }` — foi o que manteve o back
 * inteiro sem um segundo campo. O `chat_id` volta para o corpo JSON aqui, e a
 * query sai da URL: a doc lista quatro formas de passar parâmetro, mas **não**
 * garante misturar query string com corpo JSON, e não vale apostar nisso.
 */
export function extrairChatId(url: string): {
  endpoint: string;
  chatId: string;
} {
  const parsed = new URL(url);
  const chatId = parsed.searchParams.get('chat_id');
  if (!chatId) {
    throw new Error('Destino do Telegram sem chat_id configurado.');
  }
  parsed.search = '';
  return { endpoint: parsed.toString(), chatId };
}

/** A resposta do Telegram sempre traz `ok`; no erro, traz também `description`. */
interface RespostaTelegram {
  ok?: boolean;
  description?: string;
}

/**
 * Canal do Telegram. É o primeiro que **não** reusa o `postar()` puro, e a razão
 * é a doc: a resposta "sempre tem um campo booleano `ok`", e no insucesso o erro
 * vem na `description`. Como o `postar()` só julga o status HTTP, um token
 * inválido ou um chat inexistente poderia ser gravado como entrega concluída —
 * o outbox nem tentaria de novo. Aqui o corpo é lido e o `ok` é julgado.
 *
 * A `description` entra na mensagem de erro (é diagnóstico útil e não carrega a
 * credencial, que está na URL). A URL, essa, nunca entra.
 */
@Injectable()
export class TelegramChannel implements CanalDeNotificacao {
  readonly kind: NotificationChannelKind = 'TELEGRAM';

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
    if (!url) throw new Error('Destino do Telegram sem URL configurada.');
    const { endpoint, chatId } = extrairChatId(url);

    const linhas = [
      `<b>${escaparHtml(conteudo.titulo)}</b>`,
      escaparHtml(conteudo.corpo),
    ];
    // O `link` vem relativo do core (é ele que não conhece o host público) — o
    // adapter prefixa, como os canais do Slack e do Discord já fazem. Em modo
    // HTML o link mascarado é suportado sem ressalva, ao contrário do Discord.
    const appUrl = (this.config.get<string>('FRONTEND_URL') ?? '').replace(
      /\/+$/,
      '',
    );
    if (conteudo.link && appUrl) {
      linhas.push(
        `<a href="${escaparHtml(appUrl + conteudo.link)}">Abrir no CRM</a>`,
      );
    }

    const resposta = (await postarLendoResposta(
      endpoint,
      {
        chat_id: chatId,
        text: linhas.join('\n').slice(0, MAX_TEXT),
        parse_mode: 'HTML',
        // `link_preview_options` substituiu `disable_web_page_preview` na Bot
        // API 7.0 (changelog oficial, 29/12/2023). Preview aqui seria inútil: a
        // URL do CRM exige sessão.
        link_preview_options: { is_disabled: true },
      },
      conteudo.deliveryId,
    )) as RespostaTelegram;

    if (resposta?.ok !== true) {
      throw new Error(
        `O Telegram recusou a mensagem: ${
          resposta?.description ?? 'sem descrição'
        }`,
      );
    }
  }
}
