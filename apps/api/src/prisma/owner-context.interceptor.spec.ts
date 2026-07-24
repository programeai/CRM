import { of, lastValueFrom } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { ClsService } from 'nestjs-cls';
import { OwnerContextInterceptor } from './owner-context.interceptor';
import { PRISMA_TX, type PrismaService } from './prisma.service';

/** Monta um ExecutionContext HTTP com o `req.user` informado. */
function ctxWithUser(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('OwnerContextInterceptor', () => {
  let cls: { set: jest.Mock; get: jest.Mock };
  let executeRaw: jest.Mock;
  let prisma: { $transaction: jest.Mock };
  let interceptor: OwnerContextInterceptor;

  beforeEach(() => {
    cls = { set: jest.fn(), get: jest.fn() };
    executeRaw = jest.fn().mockResolvedValue(1);
    // Simula prisma.$transaction(cb) executando o callback com um tx falso.
    prisma = {
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ $executeRaw: executeRaw }),
      ),
    };
    interceptor = new OwnerContextInterceptor(
      prisma as unknown as PrismaService,
      cls as unknown as ClsService,
    );
  });

  it('abre transação, seta app.owner_id com req.user.sub e guarda o tx no CLS', async () => {
    const next: CallHandler = { handle: () => of('resultado') };
    const result = await lastValueFrom(
      interceptor.intercept(ctxWithUser({ sub: 'owner-123' }), next),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // set_config chamado via tagged template — 'owner-123' entra como bound param.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const [strings, value] = executeRaw.mock.calls[0] as [string[], string];
    expect(strings.join('?')).toContain("set_config('app.owner_id'");
    expect(value).toBe('owner-123');
    expect(cls.set).toHaveBeenCalledWith(PRISMA_TX, expect.anything());
    expect(result).toBe('resultado');
  });

  it('rota pública (sem req.user) passa direto, sem transação nem set_config', async () => {
    const next: CallHandler = { handle: () => of('publico') };
    const result = await lastValueFrom(
      interceptor.intercept(ctxWithUser(undefined), next),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    expect(cls.set).not.toHaveBeenCalled();
    expect(result).toBe('publico');
  });
});
