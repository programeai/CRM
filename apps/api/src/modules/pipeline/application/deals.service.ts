import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  DEAL_REPOSITORY,
  type DealRepository,
  type DealWithClient,
} from '../domain/deal.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { PipelineStagesService } from './pipeline-stages.service';
import { ProjectsService } from '../../projects/application/projects.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateDealDto } from '../api/dto/create-deal.dto';
import type { UpdateDealDto } from '../api/dto/update-deal.dto';
import type { ListDealsQueryDto } from '../api/dto/list-deals-query.dto';
import type { MoveDealDto } from '../api/dto/move-deal.dto';

@Injectable()
export class DealsService {
  constructor(
    @Inject(DEAL_REPOSITORY) private readonly repo: DealRepository,
    private readonly clients: ClientsService,
    private readonly stages: PipelineStagesService,
    private readonly projects: ProjectsService,
  ) {}

  async list(ownerId: string, query: ListDealsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId); // posse
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      stageId: query.stageId,
      search: query.search,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  board(ownerId: string): Promise<DealWithClient[]> {
    return this.repo.findAllForBoard(ownerId);
  }

  async findOne(ownerId: string, id: string): Promise<DealWithClient> {
    return this.loadOwned(ownerId, id);
  }

  async create(ownerId: string, dto: CreateDealDto): Promise<DealWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // valida que o cliente é do dono
    const stage = dto.stageId
      ? await this.stages.findOne(ownerId, dto.stageId)
      : await this.stages.firstStage(ownerId);
    const position = (await this.repo.maxPositionInStage(stage.id)) + 1;
    return this.repo.create({
      ownerId,
      clientId: dto.clientId,
      stageId: stage.id,
      title: dto.title,
      serviceType: dto.serviceType,
      amount: dto.amount ?? null,
      probability: dto.probability ?? null,
      expectedClose: dto.expectedClose ? new Date(dto.expectedClose) : null,
      position,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateDealDto,
  ): Promise<DealWithClient> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.serviceType !== undefined
        ? { serviceType: dto.serviceType }
        : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.probability !== undefined
        ? { probability: dto.probability }
        : {}),
      ...(dto.expectedClose !== undefined
        ? {
            expectedClose: dto.expectedClose
              ? new Date(dto.expectedClose)
              : null,
          }
        : {}),
    });
  }

  async move(
    ownerId: string,
    id: string,
    dto: MoveDealDto,
  ): Promise<DealWithClient> {
    const deal = await this.loadOwned(ownerId, id);
    const targetStage = await this.stages.findOne(ownerId, dto.stageId);
    const stageChanged = deal.stageId !== dto.stageId;

    const patch: { stageMovedAt?: Date; lostReason?: string | null } = {};
    if (stageChanged) patch.stageMovedAt = new Date();
    if (targetStage.isLost) {
      const reason = dto.lostReason?.trim();
      if (!reason)
        throw new UnprocessableEntityException('Informe o motivo da perda.');
      patch.lostReason = reason;
    } else if (stageChanged) {
      patch.lostReason = null; // saiu de "Perdeu" → limpa o motivo
    }

    const moved = await this.repo.move(id, dto.stageId, dto.position, patch);

    // Criar-ao-ganhar: ao entrar num estágio isWon, semeia um Project (idempotente).
    if (targetStage.isWon && stageChanged) {
      await this.projects.createFromDeal(moved);
    }
    return moved;
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.loadOwned(ownerId, id);
    await this.repo.delete(id);
  }

  /** Carrega o deal garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<DealWithClient> {
    const deal = await this.repo.findById(id);
    if (!deal) throw new NotFoundException('Oportunidade não encontrada.');
    await this.clients.findOne(ownerId, deal.clientId); // 404 se não for do dono
    return deal;
  }
}
