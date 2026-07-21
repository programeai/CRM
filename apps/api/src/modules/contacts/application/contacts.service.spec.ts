import { NotFoundException } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import type { ContactRepository } from '../domain/contact.repository';
import type { ClientsService } from '../../clients/application/clients.service';

describe('ContactsService', () => {
  let repo: jest.Mocked<ContactRepository>;
  let clients: jest.Mocked<Pick<ClientsService, 'findOne'>>;
  let service: ContactsService;

  beforeEach(() => {
    repo = {
      findManyByClient: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      countByClient: jest.fn(),
      clearPrimary: jest.fn(),
    };
    clients = { findOne: jest.fn().mockResolvedValue({ id: 'client-1' }) };
    service = new ContactsService(repo, clients as unknown as ClientsService);
  });

  it('força o primeiro contato do cliente a ser principal', async () => {
    repo.countByClient.mockResolvedValue(0);
    repo.create.mockResolvedValue({ id: 'ct1' } as never);
    await service.create('owner-1', 'client-1', {
      name: 'Fulano',
    });
    expect(repo.clearPrimary).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'client-1', isPrimary: true }),
    );
  });

  it('ao marcar um contato como principal, desmarca os demais antes de criar', async () => {
    repo.countByClient.mockResolvedValue(2);
    repo.create.mockResolvedValue({ id: 'ct3' } as never);
    await service.create('owner-1', 'client-1', {
      name: 'Ciclano',
      isPrimary: true,
    });
    expect(repo.clearPrimary).toHaveBeenCalledWith('client-1');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ isPrimary: true }),
    );
  });

  it('ao atualizar um contato para principal, desmarca os outros do mesmo cliente', async () => {
    repo.findById.mockResolvedValue({
      id: 'ct1',
      clientId: 'client-1',
    } as never);
    repo.update.mockResolvedValue({ id: 'ct1' } as never);
    await service.update('owner-1', 'ct1', { isPrimary: true });
    expect(repo.clearPrimary).toHaveBeenCalledWith('client-1', 'ct1');
  });

  it('lança NotFoundException ao atualizar contato inexistente', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(
      service.update('owner-1', 'nope', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('valida a posse do cliente ao listar contatos', async () => {
    repo.findManyByClient.mockResolvedValue([]);
    await service.list('owner-1', 'client-1');
    expect(clients.findOne).toHaveBeenCalledWith('owner-1', 'client-1');
    expect(repo.findManyByClient).toHaveBeenCalledWith('client-1');
  });
});
