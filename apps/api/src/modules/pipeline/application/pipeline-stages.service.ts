import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { PipelineStage } from '@prisma/client';
import {
  PIPELINE_STAGE_REPOSITORY,
  type PipelineStageRepository,
} from '../domain/pipeline-stage.repository';
import type { CreatePipelineStageDto } from '../api/dto/create-pipeline-stage.dto';
import type { UpdatePipelineStageDto } from '../api/dto/update-pipeline-stage.dto';

@Injectable()
export class PipelineStagesService {
  constructor(
    @Inject(PIPELINE_STAGE_REPOSITORY)
    private readonly repo: PipelineStageRepository,
  ) {}

  list(ownerId: string): Promise<PipelineStage[]> {
    return this.repo.findAllOrdered(ownerId);
  }

  async findOne(ownerId: string, id: string): Promise<PipelineStage> {
    const stage = await this.repo.findById(id, ownerId);
    if (!stage) throw new NotFoundException('Estágio não encontrado.');
    return stage;
  }

  /** Primeiro estágio do owner (menor `order`); destino padrão de novos deals. */
  async firstStage(ownerId: string): Promise<PipelineStage> {
    const [first] = await this.repo.findAllOrdered(ownerId);
    if (!first) throw new NotFoundException('Nenhum estágio configurado.');
    return first;
  }

  /** Primeiro estágio do owner marcado como "Ganhou" (isWon), ou null. */
  async wonStage(ownerId: string): Promise<PipelineStage | null> {
    const stages = await this.repo.findAllOrdered(ownerId);
    return stages.find((s) => s.isWon) ?? null;
  }

  async create(
    ownerId: string,
    dto: CreatePipelineStageDto,
  ): Promise<PipelineStage> {
    if (await this.repo.findByName(ownerId, dto.name)) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    const order = (await this.repo.maxOrder(ownerId)) + 1;
    return this.repo.create({
      ownerId,
      name: dto.name,
      order,
      isWon: dto.isWon ?? false,
      isLost: dto.isLost ?? false,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdatePipelineStageDto,
  ): Promise<PipelineStage> {
    const stage = await this.findOne(ownerId, id);
    if (
      dto.name &&
      dto.name !== stage.name &&
      (await this.repo.findByName(ownerId, dto.name))
    ) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    return this.repo.update(id, ownerId, dto);
  }

  /**
   * Reordena o funil. A lista tem de ser uma permutação exata dos estágios do
   * owner: `order` é atribuído pela posição, então uma lista parcial deixaria o
   * funil com `order` duplicado, e um id alheio (ou inexistente) viraria um
   * `P2025` não tratado dentro do `Promise.all` do repositório.
   */
  async reorder(ownerId: string, ids: string[]): Promise<PipelineStage[]> {
    const owned = await this.repo.findAllIds(ownerId);
    const unique = new Set(ids);
    const isPermutation =
      unique.size === ids.length &&
      unique.size === owned.length &&
      owned.every((id) => unique.has(id));
    if (!isPermutation) {
      throw new UnprocessableEntityException(
        'A lista de estágios não corresponde aos estágios do funil.',
      );
    }
    await this.repo.reorder(ownerId, ids);
    return this.repo.findAllOrdered(ownerId);
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.findOne(ownerId, id);
    if ((await this.repo.countDeals(id, ownerId)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um estágio que possui oportunidades.',
      );
    }
    await this.repo.delete(id, ownerId);
  }
}
