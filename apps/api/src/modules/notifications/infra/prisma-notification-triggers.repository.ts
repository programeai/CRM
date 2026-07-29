import { Injectable } from '@nestjs/common';
import { PrismaAdminService } from '../../../prisma/prisma-admin.service';
import { ATIVO } from '../../../shared/soft-delete';
import type {
  AlvoDeLembrete,
  NotificationTriggersRepository,
} from '../domain/notification-triggers.repository';

/**
 * Read model dos gatilhos de prazo. Todas as consultas rodam pelo **client
 * admin**: o cron é cross-owner e não tem `app.owner_id` — a policy de RLS
 * casaria zero linhas.
 *
 * Duas regras não-óbvias, que valem para as quatro consultas:
 *
 *  1. **Escalar, não join, para a workspace.** As queries do dashboard resolvem
 *     o owner por join (`client: { ownerId }`); aqui o filtro e o `select` usam o
 *     escalar `ownerId` de cada modelo, que é o que os dois crons legados já
 *     fazem — e a única forma que aproveita os índices desta fase
 *     (`[scheduledFor, completedAt]`, `[dueDate, status]`, `[validUntil, status]`).
 *  2. **Destinatário derivado (D2)**, com fallback final no owner. `ownerId` **é**
 *     o `User.id` do owner, porque owner tem `User.ownerId` nulo — ele É a
 *     workspace. Sem esse fallback, registro sem responsável não avisaria ninguém.
 */
@Injectable()
export class PrismaNotificationTriggersRepository implements NotificationTriggersRepository {
  constructor(private readonly admin: PrismaAdminService) {}

  /** (a) Follow-up agendado para hoje e ainda não concluído. */
  async followUpsDoDia(de: Date, ate: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS),
    // e isso vale também para ActivityTypeCatalog no filtro relacional abaixo.
    //
    // `type: { isFollowUp: true }` substitui o antigo `type: 'FOLLOW_UP'`: com
    // catálogo por owner não existe mais um literal comparável entre workspaces,
    // e a regra passou para uma coluna da linha do catálogo (o análogo de
    // `PipelineStage.isWon`). A seletividade continua vindo do índice
    // [scheduledFor, completedAt]; o filtro relacional só descarta os tipos
    // errados dentro da janela do dia.
    const alvos = await this.admin.activity.findMany({
      where: {
        type: { isFollowUp: true },
        completedAt: null,
        scheduledFor: { gte: de, lte: ate },
      },
      select: {
        id: true,
        ownerId: true,
        content: true,
        assigneeId: true,
        scheduledFor: true,
        clientId: true,
        client: { select: { name: true } },
      },
    });
    return alvos.map((a) => ({
      ownerId: a.ownerId,
      userId: a.assigneeId ?? a.ownerId,
      entityId: a.id,
      label: a.content.slice(0, 80),
      clienteNome: a.client.name,
      dataAlvo: a.scheduledFor!,
      clientId: a.clientId,
    }));
  }

  /** (b) Proposta viva cujo prazo de validade cai na janela. */
  async propostasAExpirar(de: Date, ate: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const alvos = await this.admin.proposal.findMany({
      where: {
        status: { in: ['SENT', 'NEGOTIATING'] },
        validUntil: { gt: de, lte: ate },
      },
      select: {
        id: true,
        ownerId: true,
        number: true,
        validUntil: true,
        deal: { select: { assigneeId: true } },
        client: { select: { name: true, assigneeId: true } },
      },
    });
    return alvos.map((p) => ({
      ownerId: p.ownerId,
      // Deal primeiro, Client depois, owner por último — Proposal não tem
      // `assigneeId` próprio.
      userId: p.deal?.assigneeId ?? p.client.assigneeId ?? p.ownerId,
      entityId: p.id,
      label: p.number,
      clienteNome: p.client.name,
      dataAlvo: p.validUntil!,
    }));
  }

  /** (c) Cobrança pendente cujo vencimento cai na janela. */
  async cobrancasAVencer(de: Date, ate: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const alvos = await this.admin.payment.findMany({
      where: { status: 'PENDING', dueDate: { gt: de, lte: ate } },
      select: {
        id: true,
        ownerId: true,
        description: true,
        dueDate: true,
        amount: true,
        contract: {
          select: { client: { select: { name: true, assigneeId: true } } },
        },
      },
    });
    return alvos.map((p) => ({
      ownerId: p.ownerId,
      // Payment não tem `assigneeId`; a cadeia é contract → client.
      userId: p.contract.client.assigneeId ?? p.ownerId,
      entityId: p.id,
      label: p.description,
      clienteNome: p.contract.client.name,
      dataAlvo: p.dueDate,
      valor: Number(p.amount),
    }));
  }

  /** (e) Demanda fora da lixeira, não concluída, com prazo já passado. */
  async demandasAtrasadas(agora: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS).
    const alvos = await this.admin.task.findMany({
      where: {
        status: { not: 'DONE' },
        dueDate: { lt: agora },
        // `Task` tem soft delete: sem este filtro o cron notificaria demanda que
        // está na lixeira. (`Activity` não tem soft delete — por isso (a) não usa.)
        ...ATIVO,
      },
      select: {
        id: true,
        ownerId: true,
        title: true,
        dueDate: true,
        assigneeId: true,
        project: { select: { client: { select: { name: true } } } },
      },
    });
    return alvos.map((t) => ({
      ownerId: t.ownerId,
      userId: t.assigneeId ?? t.ownerId,
      entityId: t.id,
      label: t.title,
      clienteNome: t.project.client.name,
      dataAlvo: t.dueDate!,
    }));
  }

  /** (f) Oportunidade viva parada há mais tempo do que o limite, fora de ganho/perda. */
  async oportunidadesEsfriando(limite: Date): Promise<AlvoDeLembrete[]> {
    // Cron cross-owner (sem contexto de request) → client admin (bypassa RLS),
    // e isso vale também para PipelineStage no filtro relacional abaixo.
    //
    // Estágio terminal fica fora: negócio ganho ou perdido não "esfria", ele
    // acabou. O filtro é pelas MARCAS (`isWon`/`isLost`), nunca pelo nome — o
    // funil é por owner desde a 20260726120000 e "Ganhou" pode se chamar
    // qualquer coisa. Mesmo par de marcas que o `apps/web` usa para decidir se
    // pinta o selo, e é o que mantém aviso e selo dizendo a mesma coisa.
    const alvos = await this.admin.deal.findMany({
      where: {
        stageMovedAt: { lt: limite },
        stage: { isWon: false, isLost: false },
        // `Deal` tem soft delete: sem este filtro o cron cobraria movimento de
        // oportunidade que está na lixeira.
        ...ATIVO,
      },
      select: {
        id: true,
        ownerId: true,
        title: true,
        stageMovedAt: true,
        assigneeId: true,
        stage: { select: { name: true } },
        client: { select: { name: true } },
      },
    });
    return alvos.map((d) => ({
      ownerId: d.ownerId,
      userId: d.assigneeId ?? d.ownerId,
      entityId: d.id,
      label: d.title,
      clienteNome: d.client.name,
      dataAlvo: d.stageMovedAt,
      estagio: d.stage.name,
    }));
  }
}
