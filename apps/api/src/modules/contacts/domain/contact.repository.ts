import type { Contact, Prisma } from '@prisma/client';

export const CONTACT_REPOSITORY = Symbol('CONTACT_REPOSITORY');

export interface ContactRepository {
  findManyByClient(clientId: string): Promise<Contact[]>;
  findById(id: string, includeArchived?: boolean): Promise<Contact | null>;
  create(data: Prisma.ContactUncheckedCreateInput): Promise<Contact>;
  update(id: string, data: Prisma.ContactUpdateInput): Promise<Contact>;
  delete(id: string): Promise<void>;
  /** Manda o contato para a lixeira. */
  archive(id: string): Promise<Contact>;
  /** Devolve o contato à área de trabalho. */
  restore(id: string): Promise<Contact>;
  /** Conta os contatos de um cliente (usado para forçar o primeiro como principal). */
  countByClient(clientId: string): Promise<number>;
  /** Desmarca isPrimary de todos os contatos do cliente (usado antes de marcar um novo principal). */
  clearPrimary(clientId: string, exceptId?: string): Promise<void>;
}
