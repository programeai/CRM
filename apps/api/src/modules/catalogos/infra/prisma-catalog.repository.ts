import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CatalogKind } from '../domain/catalog-kind';
import type {
  CatalogItem,
  CatalogRepository,
} from '../domain/catalog.repository';

/**
 * Forma estrutural mínima compartilhada pelos quatro delegates do Prisma. O
 * `any` é deliberado e está confinado a este arquivo: os delegates gerados são
 * quatro tipos distintos e a união deles rejeitaria qualquer chamada. A tipagem
 * forte volta na fronteira, em `CatalogItem`. Mesmo padrão documentado em
 * apps/web/src/hooks/use-url-filters.ts.
 */

interface CatalogDelegate {
  findMany(args: any): Promise<any[]>;
  findFirst(args: any): Promise<any>;
  create(args: any): Promise<any>;
  updateMany(args: any): Promise<{ count: number }>;
  deleteMany(args: any): Promise<{ count: number }>;
  findFirstOrThrow(args: any): Promise<any>;
}

@Injectable()
export class PrismaCatalogRepository implements CatalogRepository {
  constructor(private prisma: PrismaService) {}

  /**
   * O registry. É o único ponto que conhece a correspondência kind → tabela;
   * acrescentar um catálogo é acrescentar uma entrada aqui, uma em
   * `CATALOG_KINDS` e um `case` em `contarUsos`.
   *
   * Os quatro kinds têm tabela desde a Fase 13-A completa; o `switch` é
   * exaustivo sobre `CatalogKind`, então acrescentar um kind sem entrada aqui
   * quebra a compilação — que é o comportamento desejado.
   */
  private delegate(kind: CatalogKind): CatalogDelegate {
    const db = this.prisma.db;
    switch (kind) {
      case 'fontes-de-lead':
        return db.leadSourceCatalog;
      case 'motivos-de-perda':
        return db.lostReasonCatalog;
      case 'servicos':
        return db.serviceCatalog;
      case 'tipos-de-atividade':
        return db.activityTypeCatalog;
    }
  }

  findAll(kind: CatalogKind, ownerId: string, incluirInativos: boolean) {
    return this.delegate(kind).findMany({
      where: { ownerId, ...(incluirInativos ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    }) as Promise<CatalogItem[]>;
  }

  findById(kind: CatalogKind, id: string, ownerId: string) {
    // findFirst (não findUnique): o filtro por ownerId faz parte da busca.
    return this.delegate(kind).findFirst({
      where: { id, ownerId },
    }) as Promise<CatalogItem | null>;
  }

  findByName(kind: CatalogKind, ownerId: string, name: string) {
    return this.delegate(kind).findFirst({
      where: { ownerId, name },
    }) as Promise<CatalogItem | null>;
  }

  create(
    kind: CatalogKind,
    data: { ownerId: string; name: string; isFollowUp?: boolean },
  ) {
    return this.delegate(kind).create({ data }) as Promise<CatalogItem>;
  }

  update(
    kind: CatalogKind,
    id: string,
    ownerId: string,
    data: { name?: string; active?: boolean; isFollowUp?: boolean },
  ) {
    // updateMany garante o filtro por ownerId; devolve o registro atualizado.
    const delegate = this.delegate(kind);
    return delegate
      .updateMany({ where: { id, ownerId }, data })
      .then(() =>
        delegate.findFirstOrThrow({ where: { id, ownerId } }),
      ) as Promise<CatalogItem>;
  }

  async delete(kind: CatalogKind, id: string, ownerId: string) {
    await this.delegate(kind).deleteMany({ where: { id, ownerId } });
  }

  /**
   * `servicos` soma três tabelas porque `ServiceType` era NOT NULL em `Deal`,
   * `Proposal` e `Project`. Todas as contagens incluem arquivados: as FKs são
   * RESTRICT e um filho na lixeira faria o DELETE responder 500.
   *
   */
  async contarUsos(kind: CatalogKind, id: string, ownerId: string) {
    const db = this.prisma.db;
    switch (kind) {
      case 'fontes-de-lead':
        return db.client.count({ where: { sourceId: id, ownerId } });
      case 'motivos-de-perda':
        return db.deal.count({ where: { lostReasonId: id, ownerId } });
      case 'servicos': {
        const [deals, proposals, projects] = await Promise.all([
          db.deal.count({ where: { serviceTypeId: id, ownerId } }),
          db.proposal.count({ where: { serviceTypeId: id, ownerId } }),
          db.project.count({ where: { serviceTypeId: id, ownerId } }),
        ]);
        return deals + proposals + projects;
      }
      case 'tipos-de-atividade':
        return db.activity.count({ where: { typeId: id, ownerId } });
    }
  }

  /**
   * Desmarca `isFollowUp` dos outros itens do owner — a marca é de UM item só
   * (o cron de lembretes e o dashboard filtram por ela). A exclusividade é
   * garantida aqui, não no banco: um unique parcial impediria
   * desmarcar-e-remarcar dentro da mesma transação.
   */
  async desmarcarOutrosFollowUp(ownerId: string, exceto: string) {
    await this.prisma.db.activityTypeCatalog.updateMany({
      where: { ownerId, isFollowUp: true, id: { not: exceto } },
      data: { isFollowUp: false },
    });
  }
}
