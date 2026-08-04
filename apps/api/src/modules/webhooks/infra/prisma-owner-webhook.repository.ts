import { Injectable } from '@nestjs/common';
import type { OwnerWebhook, Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import type {
  OwnerWebhookRepository,
  PendingWebhookDelivery,
} from '../domain/owner-webhook.repository';

@Injectable()
export class PrismaOwnerWebhookRepository implements OwnerWebhookRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
  ) {}

  findManyByOwner(ownerId: string): Promise<OwnerWebhook[]> {
    return this.prisma.db.ownerWebhook.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(ownerId: string, id: string): Promise<OwnerWebhook | null> {
    return this.prisma.db.ownerWebhook.findFirst({ where: { id, ownerId } });
  }

  create(data: {
    ownerId: string;
    name: string;
    url: string;
    secret: string;
    events: string[];
  }): Promise<OwnerWebhook> {
    return this.prisma.db.ownerWebhook.create({ data });
  }

  /**
   * `updateMany` + releitura, e não `update`: o `where` do `update` do Prisma só
   * aceita campo único, então filtrar por `ownerId` junto exigiria confiar num
   * `findFirst` antes — o que abre janela entre a checagem e a escrita. Devolve
   * `null` quando nada casou (id de outro owner), e é isso que o service
   * transforma em 404.
   */
  async update(
    ownerId: string,
    id: string,
    data: Prisma.OwnerWebhookUpdateInput,
  ): Promise<OwnerWebhook | null> {
    const { count } = await this.prisma.db.ownerWebhook.updateMany({
      where: { id, ownerId },
      data,
    });
    if (count === 0) return null;
    return this.findById(ownerId, id);
  }

  replaceSecret(
    ownerId: string,
    id: string,
    secret: string,
  ): Promise<OwnerWebhook | null> {
    return this.update(ownerId, id, { secret });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.prisma.db.ownerWebhook.deleteMany({ where: { id, ownerId } });
  }

  async touchPeloSistema(id: string): Promise<void> {
    await this.admin.ownerWebhook.update({
      where: { id },
      data: { lastUsedAt: new Date() },
    });
  }

  findAtivosPorEvento(ownerId: string, evento: string) {
    return this.prisma.db.ownerWebhook.findMany({
      where: this.filtroDeElegiveis(ownerId, evento),
    });
  }

  findAtivosPorEventoPeloSistema(ownerId: string, evento: string) {
    return this.admin.ownerWebhook.findMany({
      where: this.filtroDeElegiveis(ownerId, evento),
    });
  }

  /**
   * Quem recebe: do owner, ATIVO, JÁ VERIFICADO e com o evento marcado. As três
   * condições juntas — webhook ativo mas nunca verificado é endereço que o CRM
   * não alcançou, e enfileirar para ele produziria só entregas falhas.
   */
  private filtroDeElegiveis(
    ownerId: string,
    evento: string,
  ): Prisma.OwnerWebhookWhereInput {
    return {
      ownerId,
      active: true,
      verifiedAt: { not: null },
      events: { has: evento },
    };
  }

  async enfileirar(
    entregas: Prisma.OwnerWebhookDeliveryUncheckedCreateInput[],
  ): Promise<void> {
    if (entregas.length === 0) return;
    await this.prisma.db.ownerWebhookDelivery.createMany({ data: entregas });
  }

  async enfileirarPeloSistema(
    entregas: Prisma.OwnerWebhookDeliveryUncheckedCreateInput[],
  ): Promise<void> {
    if (entregas.length === 0) return;
    await this.admin.ownerWebhookDelivery.createMany({ data: entregas });
  }

  /**
   * Reserva um lote de entregas pendentes, **atomicamente**.
   *
   * `FOR UPDATE SKIP LOCKED` e não um `findMany` simples (que é o que o outbox de
   * notificações faz): o deploy é instância única hoje por `container_name` fixo,
   * mas ligar `deploy.replicas` faria dois processos pegarem o MESMO lote e
   * entregarem o mesmo evento duas vezes. Numa outbox nova o custo de nascer
   * correta é uma cláusula; corrigir depois é migração de comportamento.
   *
   * O `UPDATE` reescreve `nextAttemptAt` com `now` — não muda nada de semântica,
   * e é o que faz a linha ser efetivamente travada e liberada no fim da
   * transação implícita, em vez de o `SELECT … FOR UPDATE` soltar o lock na
   * hora.
   *
   * Client admin: o cron roda cross-owner, sem `app.owner_id`.
   */
  reservarPendentes(
    now: Date,
    take: number,
  ): Promise<PendingWebhookDelivery[]> {
    return this.admin.$queryRaw<PendingWebhookDelivery[]>`
      WITH reservadas AS (
        SELECT d."id"
          FROM "OwnerWebhookDelivery" d
         WHERE d."status" = 'PENDING' AND d."nextAttemptAt" <= ${now}
         ORDER BY d."nextAttemptAt"
         FOR UPDATE SKIP LOCKED
         LIMIT ${take}
      )
      UPDATE "OwnerWebhookDelivery" d
         SET "nextAttemptAt" = ${now}
        FROM reservadas r, "OwnerWebhook" w
       WHERE d."id" = r."id" AND w."id" = d."webhookId"
      RETURNING d."id", d."webhookId", d."event", d."payload", d."attempts",
                w."url" AS "url", w."secret" AS "secret", w."active" AS "active";
    `;
  }

  async marcarEnviada(id: string, quando: Date): Promise<void> {
    await this.admin.ownerWebhookDelivery.update({
      where: { id },
      data: { status: 'SENT', sentAt: quando, lastError: null },
    });
  }

  async marcarFalha(
    id: string,
    attempts: number,
    proxima: Date | null,
    erro: string,
  ): Promise<void> {
    await this.admin.ownerWebhookDelivery.update({
      where: { id },
      data: {
        // `proxima` nula = o backoff esgotou: FAILED definitivo. Senão volta a
        // PENDING e a varredura do minuto seguinte pega de novo.
        status: proxima === null ? 'FAILED' : 'PENDING',
        attempts,
        ...(proxima ? { nextAttemptAt: proxima } : {}),
        lastError: erro,
      },
    });
  }
}
