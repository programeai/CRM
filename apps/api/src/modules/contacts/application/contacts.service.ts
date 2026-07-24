import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Contact } from '@prisma/client';
import {
  CONTACT_REPOSITORY,
  type ContactRepository,
} from '../domain/contact.repository';
import { ClientsService } from '../../clients/application/clients.service';
import type { CreateContactDto } from '../api/dto/create-contact.dto';
import type { UpdateContactDto } from '../api/dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(
    @Inject(CONTACT_REPOSITORY) private readonly repo: ContactRepository,
    private readonly clients: ClientsService,
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

  async delete(ownerId: string, contactId: string): Promise<void> {
    await this.loadOwned(ownerId, contactId);
    await this.repo.delete(contactId);
  }

  /** Carrega o contato garantindo que o cliente pertence ao usuário (404 caso contrário). */
  private async loadOwned(
    ownerId: string,
    contactId: string,
  ): Promise<Contact> {
    const contact = await this.repo.findById(contactId);
    if (!contact) throw new NotFoundException('Contato não encontrado.');
    await this.clients.findOne(ownerId, contact.clientId); // 404 se não for do dono
    return contact;
  }
}
