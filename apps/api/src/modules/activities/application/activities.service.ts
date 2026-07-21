import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Activity } from '@prisma/client';
import {
  ACTIVITY_REPOSITORY,
  type ActivityRepository,
} from '../domain/activity.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateActivityDto } from '../api/dto/create-activity.dto';
import type { UpdateActivityDto } from '../api/dto/update-activity.dto';
import type { ListActivitiesQueryDto } from '../api/dto/list-activities-query.dto';

@Injectable()
export class ActivitiesService {
  constructor(
    @Inject(ACTIVITY_REPOSITORY) private readonly repo: ActivityRepository,
    private readonly clients: ClientsService,
  ) {}

  async create(ownerId: string, dto: CreateActivityDto): Promise<Activity> {
    await this.clients.findOne(ownerId, dto.clientId); // garante posse
    return this.repo.create({
      clientId: dto.clientId,
      dealId: dto.dealId,
      type: dto.type,
      content: dto.content,
      scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : undefined,
    });
  }

  async list(ownerId: string, query: ListActivitiesQueryDto) {
    if (query.clientId) {
      await this.clients.findOne(ownerId, query.clientId); // garante posse
    }
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      clientId: query.clientId,
      dealId: query.dealId,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateActivityDto,
  ): Promise<Activity> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.dealId !== undefined
        ? { deal: { connect: { id: dto.dealId } } }
        : {}),
      ...(dto.type !== undefined ? { type: dto.type } : {}),
      ...(dto.content !== undefined ? { content: dto.content } : {}),
      ...(dto.scheduledFor !== undefined
        ? { scheduledFor: dto.scheduledFor ? new Date(dto.scheduledFor) : null }
        : {}),
    });
  }

  async complete(ownerId: string, id: string): Promise<Activity> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, { completedAt: new Date() });
  }

  /** Carrega a atividade garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(ownerId: string, id: string): Promise<Activity> {
    const activity = await this.repo.findById(id);
    if (!activity) throw new NotFoundException('Atividade não encontrada.');
    await this.clients.findOne(ownerId, activity.clientId); // 404 se não for do dono
    return activity;
  }
}
