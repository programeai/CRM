import type { Client, Prisma } from '@prisma/client';
import type { TagUsage } from '../../../shared/tags';

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

export interface ClientListFilter {
  ownerId: string;
  search?: string; // casa em name, tradeName, document
  status?: Client['status'];
  source?: NonNullable<Client['source']>;
  includeArchived?: boolean;
  skip: number;
  take: number;
}

/** Referência mínima de um cliente que usa determinada tag (modal de exclusão). */
export interface ClientTagRef {
  id: string;
  name: string;
}

export interface ClientRepository {
  create(data: Prisma.ClientUncheckedCreateInput): Promise<Client>;
  findById(id: string, ownerId: string): Promise<Client | null>;
  findManyAndCount(
    filter: ClientListFilter,
  ): Promise<{ data: Client[]; total: number }>;
  update(
    id: string,
    ownerId: string,
    data: Prisma.ClientUpdateInput,
  ): Promise<Client>;
  archive(id: string, ownerId: string): Promise<Client>;
  /** Existe cliente com este documento (mesmo owner), excluindo opcionalmente um id? */
  existsByDocument(
    ownerId: string,
    document: string,
    exceptId?: string,
  ): Promise<boolean>;
  /** Tags distintas do dono (agregadas dos clientes ativos) com contagem de uso. */
  listOwnerTags(ownerId: string): Promise<TagUsage[]>;
  /** Clientes do dono que usam a tag informada — alimenta o modal de exclusão. */
  findByTag(ownerId: string, tag: string): Promise<ClientTagRef[]>;
  /** Remove a tag de todos os clientes do dono; retorna quantos foram afetados. */
  removeTagFromAll(ownerId: string, tag: string): Promise<number>;
}
