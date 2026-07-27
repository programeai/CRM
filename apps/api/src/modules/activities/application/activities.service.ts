import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  ACTIVITY_REPOSITORY,
  type ActivityRepository,
  type ActivityWithAssignee,
} from '../domain/activity.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { WorkspaceMembersService } from '../../workspace/application/workspace-members.service';
import { normalizePage, paginated } from '../../../shared/pagination';
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
  ) {}

  async create(
    ownerId: string,
    dto: CreateActivityDto,
  ): Promise<ActivityWithAssignee> {
    await this.clients.findOne(ownerId, dto.clientId); // garante posse
    await this.members.assertMember(ownerId, dto.assigneeId);
    return this.repo.create({
      ownerId,
      clientId: dto.clientId,
      dealId: dto.dealId,
      type: dto.type,
      content: dto.content,
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
      assigneeId: dto.assigneeId ?? null,
    });
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

  async update(
    ownerId: string,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<ActivityWithAssignee> {
    await this.loadOwned(ownerId, id);
    await this.members.assertMember(ownerId, dto.assigneeId);
    return this.repo.update(id, {
      ...(dto.dealId !== undefined ? { dealId: dto.dealId } : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.scheduledFor !== undefined
        ? { scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null }
        : {}),
      ...(dto.assigneeId !== undefined ? { assigneeId: dto.assigneeId } : {}),
    });
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
