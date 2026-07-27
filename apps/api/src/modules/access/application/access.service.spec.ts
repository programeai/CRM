import { AccessService } from './access.service';
import { ALL_PERMISSION_KEYS } from '../../../shared/permissions';
import type { PrismaAdminService } from '../../../prisma/prisma-admin.service';

/** Só o que o AccessService usa do client admin. */
function adminMock(user: unknown) {
  return {
    user: { findUnique: jest.fn().mockResolvedValue(user) },
  } as unknown as PrismaAdminService;
}

describe('AccessService', () => {
  it('owner recebe todas as permissões e ownerId igual ao próprio id', async () => {
    const service = new AccessService(
      adminMock({
        id: 'u1',
        name: 'Dono',
        ownerId: null,
        active: true,
        role: null,
      }),
    );

    const access = await service.resolve('u1');

    expect(access).toEqual({
      userId: 'u1',
      userName: 'Dono',
      ownerId: 'u1',
      isOwner: true,
      roleId: null,
      roleName: null,
      permissions: ALL_PERMISSION_KEYS,
    });
  });

  it('colaborador recebe o ownerId do vínculo e as permissões do papel', async () => {
    const service = new AccessService(
      adminMock({
        id: 'u2',
        name: 'Colaboradora',
        ownerId: 'owner-1',
        active: true,
        role: {
          id: 'r1',
          name: 'Comercial',
          system: false,
          permissions: ['cliente:ver', 'proposta:ver'],
        },
      }),
    );

    const access = await service.resolve('u2');

    expect(access).toEqual({
      userId: 'u2',
      userName: 'Colaboradora',
      ownerId: 'owner-1',
      isOwner: false,
      roleId: 'r1',
      roleName: 'Comercial',
      permissions: ['cliente:ver', 'proposta:ver'],
    });
  });

  it('descarta do papel chave que não existe no catálogo', async () => {
    const service = new AccessService(
      adminMock({
        id: 'u3',
        ownerId: 'owner-1',
        active: true,
        role: {
          id: 'r2',
          name: 'Antigo',
          system: false,
          permissions: ['cliente:ver', 'permissao:removida'],
        },
      }),
    );

    const access = await service.resolve('u3');

    expect(access?.permissions).toEqual(['cliente:ver']);
  });

  it('papel do sistema vale o catálogo inteiro, mesmo com permissions vazio', async () => {
    const service = new AccessService(
      adminMock({
        id: 'u4',
        ownerId: 'owner-1',
        active: true,
        role: {
          id: 'r3',
          name: 'Administrador',
          system: true,
          permissions: [],
        },
      }),
    );

    const access = await service.resolve('u4');

    expect(access?.permissions).toEqual(ALL_PERMISSION_KEYS);
  });

  it('colaborador sem papel não pode nada', async () => {
    const service = new AccessService(
      adminMock({ id: 'u5', ownerId: 'owner-1', active: true, role: null }),
    );

    const access = await service.resolve('u5');

    expect(access?.permissions).toEqual([]);
  });

  it('colaborador desativado não resolve contexto', async () => {
    const service = new AccessService(
      adminMock({ id: 'u6', ownerId: 'owner-1', active: false, role: null }),
    );

    await expect(service.resolve('u6')).resolves.toBeNull();
  });

  it('usuário inexistente não resolve contexto', async () => {
    const service = new AccessService(adminMock(null));

    await expect(service.resolve('fantasma')).resolves.toBeNull();
  });
});
