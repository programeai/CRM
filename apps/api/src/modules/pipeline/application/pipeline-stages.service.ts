import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
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

  list(): Promise<PipelineStage[]> {
    return this.repo.findAllOrdered();
  }

  async findOne(id: string): Promise<PipelineStage> {
    const stage = await this.repo.findById(id);
    if (!stage) throw new NotFoundException('Estágio não encontrado.');
    return stage;
  }

  /** Primeiro estágio (menor `order`); usado como destino padrão de novos deals. */
  async firstStage(): Promise<PipelineStage> {
    const [first] = await this.repo.findAllOrdered();
    if (!first) throw new NotFoundException('Nenhum estágio configurado.');
    return first;
  }

  async create(dto: CreatePipelineStageDto): Promise<PipelineStage> {
    if (await this.repo.findByName(dto.name)) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    const order = (await this.repo.maxOrder()) + 1;
    return this.repo.create({
      name: dto.name,
      order,
      isWon: dto.isWon ?? false,
      isLost: dto.isLost ?? false,
    });
  }

  async update(
    id: string,
    dto: UpdatePipelineStageDto,
  ): Promise<PipelineStage> {
    const stage = await this.findOne(id);
    if (
      dto.name &&
      dto.name !== stage.name &&
      (await this.repo.findByName(dto.name))
    ) {
      throw new ConflictException('Já existe um estágio com este nome.');
    }
    return this.repo.update(id, dto);
  }

  async reorder(ids: string[]): Promise<PipelineStage[]> {
    await this.repo.reorder(ids);
    return this.repo.findAllOrdered();
  }

  async delete(id: string): Promise<void> {
    await this.findOne(id);
    if ((await this.repo.countDeals(id)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um estágio que possui oportunidades.',
      );
    }
    await this.repo.delete(id);
  }
}
