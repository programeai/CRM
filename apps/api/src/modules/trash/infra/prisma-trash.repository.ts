import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  TrashItem,
  TrashListFilter,
  TrashRepository,
  TrashType,
} from '../domain/trash.repository';

const ALL_TYPES: readonly TrashType[] = [
  'CLIENT',
  'CONTACT',
  'DEAL',
  'PROJECT',
  'TASK',
];

@Injectable()
export class PrismaTrashRepository implements TrashRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * Paginação em memória, e não no banco: são cinco tabelas heterogêneas e uma
   * UNION em SQL cru fugiria do Prisma sem ganho real no volume esperado (uma
   * lixeira com centenas de itens já é sinal de que falta expurgar). Se um dia
   * o volume justificar, o caminho é um `$queryRaw` com UNION ALL — o contrato
   * de `TrashItem` já está desenhado para isso.
   *
   * `Contact` não tem `createdAt` (schema.prisma), então ordenar por "arquivado
   * em" é o único critério que funciona para os cinco tipos.
   *
   * O filtro por `type` restringe quais consultas rodam — um tipo pedido é uma
   * única consulta, não as cinco.
   */
  async findManyAndCount(
    filter: TrashListFilter,
  ): Promise<{ data: TrashItem[]; total: number }> {
    const types = filter.type ? [filter.type] : ALL_TYPES;
    const buscas: Record<TrashType, () => Promise<TrashItem[]>> = {
      CLIENT: () => this.clientes(filter.ownerId),
      CONTACT: () => this.contatos(filter.ownerId),
      DEAL: () => this.deals(filter.ownerId),
      PROJECT: () => this.projetos(filter.ownerId),
      TASK: () => this.tarefas(filter.ownerId),
    };
    const resultados = await Promise.all(types.map((t) => buscas[t]()));
    const todos = resultados
      .flat()
      .sort((a, b) => b.archivedAt.getTime() - a.archivedAt.getTime());
    return {
      data: todos.slice(filter.skip, filter.skip + filter.take),
      total: todos.length,
    };
  }

  private async clientes(ownerId: string): Promise<TrashItem[]> {
    const rows = await this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: { not: null } },
      select: { id: true, name: true, archivedAt: true },
    });
    return rows.map((c) => ({
      type: 'CLIENT' as const,
      id: c.id,
      label: c.name,
      context: null,
      archivedAt: c.archivedAt!,
    }));
  }

  private async contatos(ownerId: string): Promise<TrashItem[]> {
    const rows = await this.prisma.db.contact.findMany({
      where: { ownerId, archivedAt: { not: null } },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        client: { select: { name: true } },
      },
    });
    return rows.map((c) => ({
      type: 'CONTACT' as const,
      id: c.id,
      label: c.name,
      context: c.client.name,
      archivedAt: c.archivedAt!,
    }));
  }

  private async deals(ownerId: string): Promise<TrashItem[]> {
    const rows = await this.prisma.db.deal.findMany({
      where: { ownerId, archivedAt: { not: null } },
      select: {
        id: true,
        title: true,
        archivedAt: true,
        client: { select: { name: true } },
      },
    });
    return rows.map((d) => ({
      type: 'DEAL' as const,
      id: d.id,
      label: d.title,
      context: d.client.name,
      archivedAt: d.archivedAt!,
    }));
  }

  private async projetos(ownerId: string): Promise<TrashItem[]> {
    const rows = await this.prisma.db.project.findMany({
      where: { ownerId, archivedAt: { not: null } },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        client: { select: { name: true } },
      },
    });
    return rows.map((p) => ({
      type: 'PROJECT' as const,
      id: p.id,
      label: p.name,
      context: p.client.name,
      archivedAt: p.archivedAt!,
    }));
  }

  private async tarefas(ownerId: string): Promise<TrashItem[]> {
    const rows = await this.prisma.db.task.findMany({
      where: { ownerId, archivedAt: { not: null } },
      select: {
        id: true,
        title: true,
        archivedAt: true,
        project: { select: { name: true } },
      },
    });
    return rows.map((t) => ({
      type: 'TASK' as const,
      id: t.id,
      label: t.title,
      context: t.project.name,
      archivedAt: t.archivedAt!,
    }));
  }
}
