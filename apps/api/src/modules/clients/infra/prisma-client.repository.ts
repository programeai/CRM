import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type {
  ClientChildrenCount,
  ClientImportRef,
  ClientListFilter,
  ClientRepository,
  ClientTagRef,
} from '../domain/client.repository';
import { countTags, type TagUsage } from '../../../shared/tags';
import {
  ALL_RECORDS,
  assigneeScopeWhere,
  type AssigneeScope,
} from '../../../shared/record-scope';

/** Responsável e a fonte de lead embutidos na leitura — o card e o formulário exibem o nome. */
const withAssignee = {
  assignee: { select: { id: true, name: true } },
  source: { select: { id: true, name: true, active: true } },
} satisfies Prisma.ClientInclude;

@Injectable()
export class PrismaClientRepository implements ClientRepository {
  constructor(private prisma: PrismaService) {}

  create(data: Prisma.ClientUncheckedCreateInput) {
    return this.prisma.db.client.create({ data, include: withAssignee });
  }

  findById(id: string, ownerId: string, scope: AssigneeScope = ALL_RECORDS) {
    const scoped = assigneeScopeWhere(scope);
    return this.prisma.db.client.findFirst({
      where: { id, ownerId, ...(scoped ? { AND: [scoped] } : {}) },
      include: withAssignee,
    });
  }

  async findManyAndCount(filter: ClientListFilter) {
    const scoped = assigneeScopeWhere(filter.scope);
    const where: Prisma.ClientWhereInput = {
      ownerId: filter.ownerId,
      ...(filter.includeArchived ? {} : { archivedAt: null }),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.search
        ? {
            OR: [
              { name: { contains: filter.search, mode: 'insensitive' } },
              { tradeName: { contains: filter.search, mode: 'insensitive' } },
              { document: { contains: filter.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      // AND (não spread): o `OR` da busca acima seria sobrescrito por um segundo `OR`.
      ...(scoped ? { AND: [scoped] } : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.db.client.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
        include: withAssignee,
      }),
      this.prisma.db.client.count({ where }),
    ]);
    return { data, total };
  }

  update(id: string, ownerId: string, data: Prisma.ClientUpdateInput) {
    // updateMany garante o filtro por ownerId; retorna o registro atualizado.
    return this.prisma.db.client
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        this.prisma.db.client.findFirstOrThrow({
          where: { id, ownerId },
          include: withAssignee,
        }),
      );
  }

  archive(id: string, ownerId: string) {
    return this.update(id, ownerId, { archivedAt: new Date() });
  }

  restore(id: string, ownerId: string) {
    return this.update(id, ownerId, { archivedAt: null });
  }

  async delete(id: string) {
    await this.prisma.db.client.delete({ where: { id } });
  }

  /**
   * Sem `scope`: a ingestão externa não tem sessão, logo não tem recorte por
   * responsável — e um lead repetido tem de ser reconhecido mesmo que o cadastro
   * esteja com outra pessoa, senão a deduplicação vira duplicata.
   * O mais recente primeiro: se houver mais de um, é nele que a conversa está.
   */
  findByPhoneDigits(ownerId: string, digitos: string) {
    return this.prisma.db.client.findFirst({
      where: { ownerId, archivedAt: null, phone: { contains: digitos } },
      orderBy: { createdAt: 'desc' },
      include: withAssignee,
    });
  }

  /**
   * Conta os vínculos que bloqueiam o expurgo: TODAS as FKs de filho para
   * `Client` são RESTRICT (ver specs/research/2026-07-21-fase-1-clientes.md:140).
   * A contagem soma os seis e a descrição cita o que sobrou, senão o usuário
   * tenta N vezes sem saber o motivo.
   */
  async countChildren(id: string): Promise<ClientChildrenCount> {
    const [
      contatos,
      atividades,
      oportunidades,
      propostas,
      projetos,
      contratos,
    ] = await Promise.all([
      this.prisma.db.contact.count({ where: { clientId: id } }),
      this.prisma.db.activity.count({ where: { clientId: id } }),
      this.prisma.db.deal.count({ where: { clientId: id } }),
      this.prisma.db.proposal.count({ where: { clientId: id } }),
      this.prisma.db.project.count({ where: { clientId: id } }),
      this.prisma.db.contract.count({ where: { clientId: id } }),
    ]);
    const partes: string[] = [];
    if (contatos > 0) partes.push(`${contatos} contato(s)`);
    if (atividades > 0) partes.push(`${atividades} atividade(s)`);
    if (oportunidades > 0) partes.push(`${oportunidades} oportunidade(s)`);
    if (propostas > 0) partes.push(`${propostas} proposta(s)`);
    if (projetos > 0) partes.push(`${projetos} projeto(s)`);
    if (contratos > 0) partes.push(`${contratos} contrato(s)`);
    return {
      total:
        contatos +
        atividades +
        oportunidades +
        propostas +
        projetos +
        contratos,
      descricao: partes.join(', '),
    };
  }

  async listOwnerTags(ownerId: string): Promise<TagUsage[]> {
    // Tags são um String[] por cliente (sem catálogo próprio); a fonte de verdade
    // das "tags existentes" é a agregação distinta sobre os clientes do dono.
    // Arquivados ficam fora — não aparecem na interface.
    const rows = await this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null },
      select: { tags: true },
    });
    return countTags(rows);
  }

  findByTag(ownerId: string, tag: string): Promise<ClientTagRef[]> {
    return this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null, tags: { has: tag } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async removeTagFromAll(ownerId: string, tag: string): Promise<number> {
    // Postgres não remove elemento de array em updateMany; carrega os afetados e
    // reescreve cada array sem a tag. Roda na transação do request.
    // Inclui arquivados: a tag deixa de existir em qualquer registro do dono.
    const affected = await this.prisma.db.client.findMany({
      where: { ownerId, tags: { has: tag } },
      select: { id: true, tags: true },
    });
    await Promise.all(
      affected.map((c) =>
        this.prisma.db.client.update({
          where: { id: c.id },
          data: { tags: c.tags.filter((x) => x !== tag) },
        }),
      ),
    );
    return affected.length;
  }

  async existsByDocument(ownerId: string, document: string, exceptId?: string) {
    const found = await this.prisma.db.client.findFirst({
      where: {
        ownerId,
        document,
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  findAllRefs(ownerId: string): Promise<ClientImportRef[]> {
    // Sem `scope`: a importação de contatos precisa reconhecer o cliente mesmo
    // que ele esteja com outro responsável, senão o contato viraria erro de
    // linha por um recorte de leitura. A posse continua garantida pelo ownerId
    // (e pelo RLS).
    return this.prisma.db.client.findMany({
      where: { ownerId, archivedAt: null },
      select: { id: true, name: true, document: true },
    });
  }
}
