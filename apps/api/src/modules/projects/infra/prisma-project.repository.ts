import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ProjectListFilter,
  ProjectRepository,
} from '../domain/project.repository';
import { ATIVO, ativoWhere } from '../../../shared/soft-delete';

const withClient = {
  client: { select: { id: true, name: true } },
  // Só tarefas ativas: é a contagem exibida no card do projeto. A trava de
  // expurgo usa `countTasks`, que conta tudo (FK RESTRICT).
  _count: { select: { tasks: { where: { archivedAt: null } } } },
  // O rótulo do tipo de serviço é o dado (catálogo por owner) — sem o include,
  // a UI exibiria o uuid.
  serviceType: { select: { id: true, name: true, active: true } },
} as const;

@Injectable()
export class PrismaProjectRepository implements ProjectRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ProjectUncheckedCreateInput) {
    return this.prisma.db.project.create({ data, include: withClient });
  }

  findById(id: string, includeArchived = false) {
    // findFirst (não findUnique): o soft delete faz parte da busca.
    return this.prisma.db.project.findFirst({
      where: { id, ...ativoWhere(includeArchived) },
      include: withClient,
    });
  }

  async findManyAndCount(filter: ProjectListFilter) {
    const where: Prisma.ProjectWhereInput = {
      client: { ownerId: filter.ownerId },
      ...ATIVO,
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.search
        ? { name: { contains: filter.search, mode: 'insensitive' } }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.project.findMany({
        where,
        include: withClient,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.db.project.count({ where }),
    ]);
    return { data, total };
  }

  findByClient(clientId: string) {
    return this.prisma.db.project.findMany({
      where: { clientId, ...ATIVO },
      include: withClient,
      orderBy: { createdAt: 'desc' },
    });
  }

  update(id: string, data: Prisma.ProjectUpdateInput) {
    return this.prisma.db.project.update({
      where: { id },
      data,
      include: withClient,
    });
  }

  async delete(id: string) {
    await this.prisma.db.project.delete({ where: { id } });
  }

  archive(id: string) {
    return this.prisma.db.project.update({
      where: { id },
      data: { archivedAt: new Date() },
      include: withClient,
    });
  }

  restore(id: string) {
    return this.prisma.db.project.update({
      where: { id },
      data: { archivedAt: null },
      include: withClient,
    });
  }

  /**
   * Conta TODAS as tarefas, inclusive arquivadas: quem consome isto é a trava
   * de expurgo, e a FK `Task.projectId` é RESTRICT — apagar o projeto com uma
   * tarefa arquivada pendurada responderia 500 de FK. Para a contagem exibida
   * na listagem, ver `_count` em `withClient`.
   */
  async countTasks(projectId: string) {
    return this.prisma.db.task.count({ where: { projectId } });
  }

  /**
   * Inclui projeto arquivado: este método é o dedupe do "criar-ao-ganhar"
   * (DealsService.move). Ignorar o arquivado faria uma segunda passagem pelo
   * estágio "Ganhou" criar um projeto duplicado.
   */
  findByDealId(dealId: string) {
    return this.prisma.db.project.findFirst({
      where: { dealId },
      include: withClient,
    });
  }
}
