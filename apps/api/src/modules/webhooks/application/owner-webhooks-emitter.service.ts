import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import {
  ACCESS_CONTEXT,
  type AccessContext,
} from '../../access/domain/access-context';
import {
  OWNER_WEBHOOK_REPOSITORY,
  type OwnerWebhookRepository,
} from '../domain/owner-webhook.repository';
import type { OwnerWebhookEvent } from '../domain/owner-webhook-event';

/** Emissão no caminho de requisição HTTP: o `ownerId` vem do CLS. */
export interface EntradaDeEvento {
  evento: OwnerWebhookEvent;
  /** Id do registro que originou o evento. Vai no corpo, para dedupe do outro lado. */
  entityId: string;
  /**
   * O mínimo que serve a uma automação. **Nada de dado sensível a mais** do que a
   * notificação já carrega: o payload sai da workspace e vai para um servidor de
   * terceiro. `link`, quando houver, é caminho relativo (como no conteúdo neutro
   * da Fase 9).
   */
  dados: Record<string, unknown>;
}

/** Emissão fora do request (cron, ingestão): `ownerId` explícito. */
export interface EntradaDeEventoDoSistema extends EntradaDeEvento {
  ownerId: string;
}

/**
 * Emissão de evento de negócio para os webhooks do owner.
 *
 * Chamada DIRETA nos pontos de emissão, espelhando `NotificationsService` — sem
 * event bus. Não há bus no projeto e o motor de regras é a Fase 16; introduzir
 * `@nestjs/event-emitter` aqui antecipa uma decisão de outra fase para servir a
 * um único produtor.
 *
 * Duas superfícies, pela mesma razão do `NotificationsService`:
 *  - `emitir`            → dentro da transação do request (`prisma.db`);
 *  - `emitirPeloSistema` → cron cross-owner, sem `app.owner_id` (client admin).
 *
 * **Engole a própria exceção nas duas.** Um webhook que não pôde ser enfileirado
 * não pode derrubar a operação de negócio que o disparou — mesma divergência
 * deliberada em relação ao `AuditService` que o `NotificationsService` documenta.
 *
 * O que roda dentro da transação é SÓ banco: um SELECT nos webhooks do owner
 * (tabela de unidades de linha, indexada por `ownerId`) e N inserts na outbox.
 * **Zero I/O de rede** — a entrega acontece depois do commit, varrida pelo cron.
 */
@Injectable()
export class OwnerWebhooksEmitterService {
  private readonly logger = new Logger(OwnerWebhooksEmitterService.name);

  constructor(
    @Inject(OWNER_WEBHOOK_REPOSITORY)
    private readonly repo: OwnerWebhookRepository,
    private readonly cls: ClsService,
  ) {}

  async emitir(entrada: EntradaDeEvento): Promise<void> {
    const access = this.cls.get<AccessContext>(ACCESS_CONTEXT);
    if (!access) {
      this.logger.warn({
        evento: 'webhook.sem_contexto',
        msg: 'Tentativa de emitir evento de webhook sem contexto de acesso.',
        tipo: entrada.evento,
      });
      return;
    }
    try {
      const webhooks = await this.repo.findAtivosPorEvento(
        access.ownerId,
        entrada.evento,
      );
      if (webhooks.length === 0) return;
      await this.repo.enfileirar(
        this.montarLinhas(access.ownerId, webhooks, entrada),
      );
    } catch (erro) {
      this.falhou(entrada.evento, erro);
    }
  }

  async emitirPeloSistema(entrada: EntradaDeEventoDoSistema): Promise<void> {
    try {
      const webhooks = await this.repo.findAtivosPorEventoPeloSistema(
        entrada.ownerId,
        entrada.evento,
      );
      if (webhooks.length === 0) return;
      await this.repo.enfileirarPeloSistema(
        this.montarLinhas(entrada.ownerId, webhooks, entrada),
      );
    } catch (erro) {
      this.falhou(entrada.evento, erro);
    }
  }

  /**
   * Uma linha de outbox por webhook elegível. O `payload` é montado AGORA e
   * guardado: a entrega acontece depois do commit, e o estado do registro pode
   * ter mudado no meio — o evento tem de contar o que aconteceu, não o que está
   * acontecendo.
   */
  private montarLinhas(
    ownerId: string,
    webhooks: { id: string }[],
    entrada: EntradaDeEvento,
  ): Prisma.OwnerWebhookDeliveryUncheckedCreateInput[] {
    const payload = {
      evento: entrada.evento,
      registroId: entrada.entityId,
      // ISO 8601 em UTC: quem consome converte para o fuso dele.
      ocorridoEm: new Date().toISOString(),
      dados: entrada.dados,
    } as Prisma.InputJsonValue;
    return webhooks.map((w) => ({
      ownerId,
      webhookId: w.id,
      event: entrada.evento,
      payload,
    }));
  }

  /**
   * Nunca loga o `dados`: ele carrega nome de cliente e valor de cobrança, e o
   * Grafana é publicado na internet.
   */
  private falhou(evento: string, erro: unknown): void {
    this.logger.error(
      {
        evento: 'webhook.emissao_falhou',
        msg: 'Falha ao enfileirar evento de webhook.',
        tipo: evento,
      },
      erro instanceof Error ? erro.stack : undefined,
    );
  }
}
