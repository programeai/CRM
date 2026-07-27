import type { Client, Prisma } from '@prisma/client';
import type { TagUsage } from '../../../shared/tags';
import type { AssigneeScope } from '../../../shared/record-scope';

export const CLIENT_REPOSITORY = Symbol('CLIENT_REPOSITORY');

/** Responsável embutido na leitura — o card e o formulário exibem o nome. */
export interface AssigneeRef {
  id: string;
  name: string;
}

export type ClientWithAssignee = Client & { assignee: AssigneeRef | null };

export interface ClientListFilter {
  ownerId: string;
  search?: string; // casa em name, tradeName, document
  status?: Client['status'];
  source?: NonNullable<Client['source']>;
  includeArchived?: boolean;
  /** Filtro explícito da query (`?assigneeId=`). */
  assigneeId?: string;
  /** Recorte por permissão — independente do filtro acima; os dois se somam. */
  scope: AssigneeScope;
  skip: number;
  take: number;
}

/** Referência mínima de um cliente que usa determinada tag (modal de exclusão). */
export interface ClientTagRef {
  id: string;
  name: string;
}

/** Contagem de vínculos que bloqueiam o expurgo (FKs RESTRICT), já com descrição em pt-BR. */
export interface ClientChildrenCount {
  total: number;
  descricao: string;
}

export interface ClientRepository {
  create(data: Prisma.ClientUncheckedCreateInput): Promise<ClientWithAssignee>;
  findById(
    id: string,
    ownerId: string,
    scope?: AssigneeScope,
  ): Promise<ClientWithAssignee | null>;
  findManyAndCount(
    filter: ClientListFilter,
  ): Promise<{ data: ClientWithAssignee[]; total: number }>;
  update(
    id: string,
    ownerId: string,
    data: Prisma.ClientUpdateInput,
  ): Promise<ClientWithAssignee>;
  archive(id: string, ownerId: string): Promise<ClientWithAssignee>;
  /** Devolve o cliente à área de trabalho. */
  restore(id: string, ownerId: string): Promise<ClientWithAssignee>;
  delete(id: string): Promise<void>;
  /** Conta os vínculos (FKs RESTRICT) que impedem o expurgo. */
  countChildren(id: string): Promise<ClientChildrenCount>;
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
