import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Deal } from '@prisma/client';
import {
  PROJECT_REPOSITORY,
  type ProjectRepository,
  type ProjectWithClient,
} from '../domain/project.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { AuditService } from '../../audit/audit.service';
import { assertArquivado, assertSemFilhos } from '../../../shared/purge';
import { normalizePage, paginated } from '../../../shared/pagination';
import type { CreateProjectDto } from '../api/dto/create-project.dto';
import type { UpdateProjectDto } from '../api/dto/update-project.dto';
import type { ListProjectsQueryDto } from '../api/dto/list-projects-query.dto';
import { CatalogosService } from '../../catalogos/application/catalogos.service';

@Injectable()
export class ProjectsService {
  constructor(
    @Inject(PROJECT_REPOSITORY) private readonly repo: ProjectRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
    private readonly catalogos: CatalogosService,
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
    await this.catalogos.assertUtilizavel(
      ownerId,
      'servicos',
      dto.serviceTypeId,
    );
    return this.repo.create({
      ownerId,
      clientId: dto.clientId,
      name: dto.name,
      serviceTypeId: dto.serviceTypeId,
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
    if (dto.serviceTypeId !== undefined) {
      await this.catalogos.assertUtilizavel(
        ownerId,
        'servicos',
        dto.serviceTypeId,
      );
    }
    return this.repo.update(id, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.serviceTypeId !== undefined
        ? { serviceTypeId: dto.serviceTypeId }
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

  /** Manda o projeto para a lixeira. Sem cascata: as tarefas dele continuam ativas. */
  async archive(ownerId: string, id: string): Promise<ProjectWithClient> {
    const project = await this.loadOwned(ownerId, id);
    const arquivado = await this.repo.archive(id);
    await this.audit.registrar({
      entity: 'PROJECT',
      entityId: id,
      entityLabel: project.name,
      action: 'ARQUIVAR',
    });
    return arquivado;
  }

  /** Devolve o projeto à área de trabalho. */
  async restore(ownerId: string, id: string): Promise<ProjectWithClient> {
    const project = await this.loadOwned(ownerId, id, true);
    const restaurado = await this.repo.restore(id);
    await this.audit.registrar({
      entity: 'PROJECT',
      entityId: id,
      entityLabel: project.name,
      action: 'RESTAURAR',
    });
    return restaurado;
  }

  /**
   * Expurgo. `Task.projectId` é FK obrigatória com RESTRICT: um projeto com
   * qualquer tarefa (ativa OU arquivada) não pode ser apagado. `Contract.projectId`
   * é opcional com SET NULL — contrato vinculado não bloqueia.
   */
  async purge(ownerId: string, id: string): Promise<void> {
    const project = await this.loadOwned(ownerId, id, true);
    assertArquivado(project.archivedAt, 'um projeto');
    assertSemFilhos(
      await this.repo.countTasks(id),
      'Não é possível excluir em definitivo um projeto que ainda tem demandas. Expurgue as demandas dele primeiro.',
    );
    await this.repo.delete(id);
    await this.audit.registrar({
      entity: 'PROJECT',
      entityId: id,
      entityLabel: project.name,
      action: 'EXPURGAR',
    });
  }

  /**
   * Cria um Project a partir de um Deal ganho, se ainda não existir um vinculado
   * a esse deal. Idempotente: chamadas repetidas para o mesmo deal não duplicam.
   */
  async createFromDeal(deal: Deal): Promise<void> {
    const existing = await this.repo.findByDealId(deal.id);
    if (existing) return;
    // Cópia de FK entre registros: o item do catálogo tem de pertencer ao MESMO
    // owner do projeto que está sendo criado. Hoje `deal.ownerId` é o owner do
    // request, então isto é redundante por construção — e é exatamente por isso
    // que fica escrito: se um dia o criar-ao-ganhar rodar fora do contexto do
    // owner, esta linha é o que impede a FK cruzada.
    await this.catalogos.findOne(deal.ownerId, 'servicos', deal.serviceTypeId);
    await this.repo.create({
      ownerId: deal.ownerId,
      clientId: deal.clientId,
      dealId: deal.id,
      name: deal.title,
      serviceTypeId: deal.serviceTypeId,
      // proposalId fica null: o move não conhece a proposta; opcional em Project.
    });
  }

  /** Carrega o projeto garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    id: string,
    includeArchived = false,
  ): Promise<ProjectWithClient> {
    const project = await this.repo.findById(id, includeArchived);
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    await this.clients.findOne(ownerId, project.clientId); // 404 se não for do dono
    return project;
  }
}
