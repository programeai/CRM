import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccessGuard } from './access.guard';
import type { AccessService } from './application/access.service';
import type {
  AccessContext,
  AuthenticatedRequest,
} from './domain/access-context';

const OWNER: AccessContext = {
  userId: 'u1',
  ownerId: 'u1',
  isOwner: true,
  roleId: null,
  roleName: null,
  permissions: ['cliente:ver'],
};

function contextWith(req: AuthenticatedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

/** `getAllAndOverride` responde pelo mapa de metadados informado. */
function reflectorWith(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: (key: string) => metadata[key],
  } as unknown as Reflector;
}

function accessMock(resolved: AccessContext | null): AccessService {
  return {
    resolve: jest.fn().mockResolvedValue(resolved),
  } as unknown as AccessService;
}

describe('AccessGuard', () => {
  it('libera rota pública sem resolver contexto', async () => {
    const access = accessMock(null);
    const guard = new AccessGuard(reflectorWith({ isPublic: true }), access);

    await expect(
      guard.canActivate(contextWith({} as AuthenticatedRequest)),
    ).resolves.toBe(true);
    expect(access.resolve).not.toHaveBeenCalled();
  });

  it('publica req.access quando a rota não exige permissão', async () => {
    const req = { user: { sub: 'u1' } } as AuthenticatedRequest;
    const guard = new AccessGuard(reflectorWith({}), accessMock(OWNER));

    await expect(guard.canActivate(contextWith(req))).resolves.toBe(true);
    expect(req.access).toEqual(OWNER);
  });

  it('nega com 401 quando o contexto não resolve (usuário desativado)', async () => {
    const guard = new AccessGuard(reflectorWith({}), accessMock(null));

    await expect(
      guard.canActivate(
        contextWith({ user: { sub: 'u1' } } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('libera quando o usuário tem uma das permissões exigidas', async () => {
    const guard = new AccessGuard(
      reflectorWith({
        requirePermission: ['cliente:ver', 'cliente:gerenciar'],
      }),
      accessMock(OWNER),
    );

    await expect(
      guard.canActivate(
        contextWith({ user: { sub: 'u1' } } as AuthenticatedRequest),
      ),
    ).resolves.toBe(true);
  });

  it('nega com 403 em pt-BR quando falta a permissão', async () => {
    const guard = new AccessGuard(
      reflectorWith({ requirePermission: ['financeiro:gerenciar'] }),
      accessMock(OWNER),
    );

    await expect(
      guard.canActivate(
        contextWith({ user: { sub: 'u1' } } as AuthenticatedRequest),
      ),
    ).rejects.toThrow('Você não tem permissão para gerenciar financeiro.');
  });

  it('nega com 403 e não vaza a chave técnica na mensagem', async () => {
    const guard = new AccessGuard(
      reflectorWith({ requirePermission: ['papel:gerenciar'] }),
      accessMock(OWNER),
    );

    await expect(
      guard.canActivate(
        contextWith({ user: { sub: 'u1' } } as AuthenticatedRequest),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
