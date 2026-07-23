import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Deal } from '@prisma/client';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
  type ProjectWithClient,
} from '../domain/project.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateProjectDto } from '../api/dto/create-project.dto';
import type { UpdateProjectDto } from '../api/dto/update-project.dto';
import type { ListProjectsQueryDto } from '../api/dto/list-projects-query.dto';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    private readonly clients: ClientsService,
  ) {}

  async list(ownerId: string, query: ListProjectsQueryDto) {
    if (query.clientId) await this.clients.findOne(ownerId, query.clientId);
    const { page, limit, skip, take } = normalizePage(query.page, query.limit);
    const { data, total } = await this.repo.findManyAndCount({
      ownerId,
      clientId: query.clientId,
      status: query.status,
      search: query.search,
      skip,
      take,
    });
    return paginated(data, total, page, limit);
  }

  async listByClient(
    ownerId: string,
    clientId: string,
  ): Promise<ProjectWithClient[]> {
    await this.clients.findOne(ownerId, clientId); // posse
    return this.repo.findByClient(clientId);
  }

  async findOne(ownerId: string, id: string): Promise<ProjectWithClient> {
    return this.loadOwned(ownerId, id);
  }

  async create(
    ownerId: string,
    dto: CreateProjectDto,
  ): Promise<ProjectWithClient> {
    await this.clients.findOne(ownerId, dto.clientId); // valida posse do cliente
    return this.repo.create({
      clientId: dto.clientId,
      name: dto.name,
      serviceType: dto.serviceType,
      proposalId: dto.proposalId ?? null,
      startDate: dto.startDate ? new Date(dto.startDate) : null,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
    });
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateProjectDto,
  ): Promise<ProjectWithClient> {
    await this.loadOwned(ownerId, id);
    return this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.serviceType !== undefined
        ? { serviceType: dto.serviceType }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.startDate !== undefined
        ? { startDate: dto.startDate ? new Date(dto.startDate) : null }
        : {}),
      ...(dto.dueDate !== undefined
        ? { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }
        : {}),
    });
  }

  async delete(ownerId: string, id: string): Promise<void> {
    await this.loadOwned(ownerId, id);
    if ((await this.repo.countTasks(id)) > 0) {
      throw new ConflictException(
        'Não é possível excluir um projeto que possui tarefas.',
      );
    }
    await this.repo.delete(id);
  }

  /**
   * Cria um Project a partir de um Deal ganho, se ainda não existir um vinculado
   * a esse deal. Idempotente: chamadas repetidas para o mesmo deal não duplicam.
   */
  async createFromDeal(deal: Deal): Promise<void> {
    const existing = await this.repo.findByDealId(deal.id);
    if (existing) return;
    await this.repo.create({
      clientId: deal.clientId,
      dealId: deal.id,
      name: deal.title,
      serviceType: deal.serviceType,
      // proposalId fica null: o move não conhece a proposta; opcional em Project.
    });
  }

  /** Carrega o projeto garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
  ): Promise<ProjectWithClient> {
    const project = await this.repo.findById(id);
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    await this.clients.findOne(ownerId, project.clientId); // 404 se não for do dono
    return project;
  }
}
