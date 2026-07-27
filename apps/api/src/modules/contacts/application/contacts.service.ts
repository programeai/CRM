import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Contact } from '@prisma/client';
import {
  CONTACT_REPOSITORY,
  type ContactRepository,
} from '../domain/contact.repository';
import { ClientsService } from '../../clients/application/clients.service';
import { AuditService } from '../../audit/audit.service';
import { assertArquivado } from '../../../shared/purge';
import type { CreateContactDto } from '../api/dto/create-contact.dto';
import type { UpdateContactDto } from '../api/dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    @Inject(CONTACT_REPOSITORY) private readonly repo: ContactRepository,
    private readonly clients: ClientsService,
    private readonly audit: AuditService,
  ) {}

  async list(ownerId: string, clientId: string): Promise<Contact[]> {
    await this.clients.findOne(ownerId, clientId); // garante posse
    return this.repo.findManyByClient(clientId);
  }

  async create(
    ownerId: string,
    clientId: string,
    dto: CreateContactDto,
  ): Promise<Contact> {
    const client = await this.clients.findOne(ownerId, clientId); // garante posse
    // Primeiro contato do cliente sempre vira o principal.
    const isFirst = (await this.repo.countByClient(clientId)) === 0;
    const isPrimary = isFirst || dto.isPrimary === true;
    if (isPrimary && !isFirst) {
      await this.repo.clearPrimary(clientId);
    }
    return this.repo.create({
      ...dto,
      clientId,
      isPrimary,
      ownerId: client.ownerId,
    });
  }

  async update(
    ownerId: string,
    contactId: string,
    dto: UpdateContactDto,
  ): Promise<Contact> {
    const contact = await this.loadOwned(ownerId, contactId);
    if (dto.isPrimary === true) {
      await this.repo.clearPrimary(contact.clientId, contactId);
    }
    return this.repo.update(contactId, dto);
  }

  /** Manda o contato para a lixeira. Substitui o antigo hard delete. */
  async archive(ownerId: string, contactId: string): Promise<Contact> {
    const contact = await this.loadOwned(ownerId, contactId);
    const arquivado = await this.repo.archive(contactId);
    await this.audit.registrar({
      entity: 'CONTACT',
      entityId: contactId,
      entityLabel: contact.name,
      action: 'ARQUIVAR',
    });
    return arquivado;
  }

  /** Devolve o contato à aba do cliente. */
  async restore(ownerId: string, contactId: string): Promise<Contact> {
    const contact = await this.loadOwned(ownerId, contactId, true);
    const restaurado = await this.repo.restore(contactId);
    await this.audit.registrar({
      entity: 'CONTACT',
      entityId: contactId,
      entityLabel: contact.name,
      action: 'RESTAURAR',
    });
    return restaurado;
  }

  /** Expurgo: apaga de vez. Contact não tem filhos — sem trava adicional. */
  async purge(ownerId: string, contactId: string): Promise<void> {
    const contact = await this.loadOwned(ownerId, contactId, true);
    assertArquivado(contact.archivedAt, 'um contato');
    await this.repo.delete(contactId);
    await this.audit.registrar({
      entity: 'CONTACT',
      entityId: contactId,
      entityLabel: contact.name,
      action: 'EXPURGAR',
    });
  }

  /** Carrega o contato garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    contactId: string,
    includeArchived = false,
  ): Promise<Contact> {
    const contact = await this.repo.findById(contactId, includeArchived);
    if (!contact) throw new NotFoundException('Contato não encontrado.');
    await this.clients.findOne(ownerId, contact.clientId); // 404 se não for do dono
    return contact;
  }
}
