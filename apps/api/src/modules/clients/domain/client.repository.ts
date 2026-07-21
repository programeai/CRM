import type { Client, Prisma } from '@prisma/client';

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
}
