import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACTIVITY_REPOSITORY,
  type ActivityRepository,
  type ActivityWithAssignee,
} from '../domain/activity.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { CatalogosService } from '../../catalogos/application/catalogos.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import { assigneeMudou } from '../../../shared/assignee-changed';
import { ALL_RECORDS, type AssigneeScope } from '../../../shared/record-scope';
import type { CreateActivityDto } from '../api/dto/create-activity.dto';
import type { UpdateActivityDto } from '../api/dto/update-activity.dto';
import type { ListActivitiesQueryDto } from '../api/dto/list-activities-query.dto';

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly repo: ActivityRepository,
    private readonly clients: ClientsService,
    private readonly members: WorkspaceMembersService,
    private readonly notifications: NotificationsService,
    private readonly catalogos: CatalogosService,
  ) {}

  async create(
    ownerId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityWithAssignee> {
    await this.clients.findOne(ownerId, dto.clientId); // garante posse
    await this.members.assertMember(ownerId, dto.assigneeId);
    await this.catalogos.assertUtilizavel(
      ownerId,
      'tipos-de-atividade',
      dto.typeId,
    );
    const criada = await this.repo.create({
      ownerId,
      clientId: dto.clientId,
      dealId: dto.dealId,
      typeId: dto.typeId,
      content: dto.content,
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
      assigneeId: dto.assigneeId ?? null,
    });
    // Gatilho (f). Atividade não tem título: o rótulo é o começo do conteúdo,
    // mesmo desenho denormalizado da trilha de auditoria. Auto-atribuição é
    // descartada dentro do `notificar`.
    if (dto.assigneeId) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'ACTIVITY',
          entityId: criada.id,
          entityLabel: criada.content.slice(0, 80),
          clientId: criada.clientId,
        },
      });
    }
    return criada;
  }

  async list(
    ownerId: string,
    query: ListActivitiesQueryDto,
    scope: AssigneeScope = ALL_RECORDS,
  ) {
    if (query.clientId) {
      await this.clients.findOne(ownerId, query.clientId); // garante posse
    }
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      dealId: query.dealId,
      assigneeId: query.assigneeId,
      scope,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  /**
   * Próximo follow-up pendente de cada oportunidade, indexado por `dealId`.
   *
   * É a porta pela qual o `DealsService` obtém o sinal de "próximo passo" do card
   * do funil — o módulo `pipeline` não toca a tabela de atividades, ele chama
   * este service (fronteira do modular monolith).
   *
   * `scope` aqui é o recorte de ATIVIDADE (`cliente:ver_todos`), não o de
   * oportunidade: quem não pode ver a atividade de outra pessoa também não vê a
   * data dela no card.
   */
  async proximaPorDeal(
    ownerId: string,
    dealIds: string[],
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<Map<string, Date>> {
    const rows = await this.repo.nextScheduledByDeal(ownerId, dealIds, scope);
    return new Map(rows.map((r) => [r.dealId, r.scheduledFor]));
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityWithAssignee> {
    const antes = await this.loadOwned(ownerId, id);
    await this.members.assertMember(ownerId, dto.assigneeId);
    if (dto.typeId !== undefined) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'tipos-de-atividade',
        dto.typeId,
      );
    }
    const atualizada = await this.repo.update(id, {
      ...(dto.dealId !== undefined ? { dealId: dto.dealId } : {}),
      ...(dto.typeId !== undefined ? { typeId: dto.typeId } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.scheduledFor !== undefined
        ? { scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null }
        : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
    });
    if (assigneeMudou(dto.assigneeId, antes.assigneeId)) {
      await this.notifications.notificar({
        userId: dto.assigneeId,
        evento: {
          tipo: 'RECORD_ASSIGNED',
          entity: 'ACTIVITY',
          entityId: id,
          entityLabel: atualizada.content.slice(0, 80),
          clientId: atualizada.clientId,
        },
      });
    }
    return atualizada;
  }

  async complete(ownerId: string, id: string): Promise<ActivityWithAssignee> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, { completedAt: new Date() });
  }

  /**
   * Carrega a atividade garantindo que o cliente pertence ao usuário (404 caso
   * contrário). `scope` só é passado nas leituras: escrita não é recortada.
   */
  private async loadOwned(
    ownerId: string,
    id: string,
    scope: AssigneeScope = ALL_RECORDS,
  ): Promise<ActivityWithAssignee> {
    const activity = await this.repo.findById(id, scope);
    if (!activity) throw new NotFoundException('Atividade não encontrada.');
    await this.clients.findOne(ownerId, activity.clientId); // 404 se não for do dono
    return activity;
  }
}
