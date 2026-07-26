import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { RolesService } from './roles.service';
import { ALL_PERMISSION_KEYS } from '../../../shared/permissions';
import type { RoleRepository, RoleWithUsage } from '../domain/role.repository';

const OWNER = 'owner-1';

function role(overrides: Partial<RoleWithUsage> = {}): RoleWithUsage {
  return {
    id: 'r1',
    ownerId: OWNER,
    name: 'Comercial',
    description: null,
    system: false,
    permissions: ['cliente:ver'],
    collaboratorsCount: 0,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

describe('RolesService', () => {
  let repo: jest.Mocked<RoleRepository>;
  let service: RolesService;

  beforeEach(() => {
    repo = {
      findManyByOwner: jest.fn(),
      findById: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn((data) =>
        Promise.resolve(role(data as Partial<RoleWithUsage>)),
      ),
      update: jest.fn((_id, _owner, data) =>
        Promise.resolve(role(data as Partial<RoleWithUsage>)),
      ),
      updatePermissions: jest.fn((_id, _owner, permissions) =>
        Promise.resolve(role({ permissions })),
      ),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    service = new RolesService(repo);
  });

  describe('create', () => {
    it('descarta chave fora do catálogo antes de gravar', async () => {
      await service.create(OWNER, {
        name: 'Comercial',
        permissions: ['cliente:ver', 'chave:inventada'],
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ permissions: ['cliente:ver'] }),
      );
    });

    it('rejeita nome já usado no mesmo owner', async () => {
      repo.findByName.mockResolvedValue(role({ id: 'outro' }));

      await expect(
        service.create(OWNER, { name: 'Comercial', permissions: [] }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('update', () => {
    it('recusa editar o papel do sistema', async () => {
      repo.findById.mockResolvedValue(role({ system: true }));

      await expect(
        service.update(OWNER, 'r1', { name: 'Outro', permissions: [] }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('aceita manter o próprio nome (não conflita consigo mesmo)', async () => {
      repo.findById.mockResolvedValue(role());
      repo.findByName.mockResolvedValue(role());

      await expect(
        service.update(OWNER, 'r1', {
          name: 'Comercial',
          permissions: ['cliente:ver'],
        }),
      ).resolves.toEqual(expect.objectContaining({ name: 'Comercial' }));
    });

    it('falha com 404 quando o papel não é do owner', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.update(OWNER, 'de-outro-owner', { name: 'X', permissions: [] }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('remove', () => {
    it('recusa excluir papel em uso por colaboradores', async () => {
      repo.findById.mockResolvedValue(role({ collaboratorsCount: 2 }));

      await expect(service.remove(OWNER, 'r1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('recusa excluir o papel do sistema', async () => {
      repo.findById.mockResolvedValue(role({ system: true }));

      await expect(service.remove(OWNER, 'r1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('exclui papel sem uso', async () => {
      repo.findById.mockResolvedValue(role());

      await service.remove(OWNER, 'r1');

      expect(repo.delete).toHaveBeenCalledWith('r1', OWNER);
    });
  });

  describe('list', () => {
    it('mostra o papel do sistema com o catálogo inteiro', async () => {
      repo.findManyByOwner.mockResolvedValue([
        role({ system: true, permissions: [] }),
      ]);

      const [administrador] = await service.list(OWNER);

      expect(administrador.permissions).toEqual(ALL_PERMISSION_KEYS);
    });
  });
});
