import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PublicApiKeyGuard } from './public-api-key.guard';
import { API_CONTEXT, type RequisicaoDaApi } from './api-context';
import type { IntegrationKeysService } from '../../integracoes/application/integration-keys.service';

function contextoHttp(req: Partial<RequisicaoDaApi>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

describe('PublicApiKeyGuard', () => {
  let keys: { autenticar: jest.Mock };
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: PublicApiKeyGuard;
  let errorSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    keys = {
      autenticar: jest.fn().mockResolvedValue({
        ownerId: 'owner-1',
        keyId: 'chave-1',
        keyName: 'ERP da produção',
      }),
    };
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue('cliente:escrever'),
    };
    guard = new PublicApiKeyGuard(
      keys as unknown as IntegrationKeysService,
      reflector as unknown as Reflector,
    );
    errorSpy = jest
      .spyOn(
        (guard as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    warnSpy = jest
      .spyOn(
        (guard as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);
  });

  it('publica os três campos do contexto no request', async () => {
    const req: Partial<RequisicaoDaApi> = {
      headers: { authorization: 'Bearer crm_valor' },
    };

    await expect(guard.canActivate(contextoHttp(req))).resolves.toBe(true);

    expect(keys.autenticar).toHaveBeenCalledWith(
      'crm_valor',
      'cliente:escrever',
    );
    expect(req[API_CONTEXT]).toEqual({
      ownerId: 'owner-1',
      keyId: 'chave-1',
      keyName: 'ERP da produção',
    });
  });

  it('FECHA a rota sem @EscopoExigido, em vez de aceitar qualquer chave', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const req: Partial<RequisicaoDaApi> = {
      headers: { authorization: 'Bearer crm_valor' },
    };

    await expect(guard.canActivate(contextoHttp(req))).rejects.toThrow(
      UnauthorizedException,
    );
    // Não chega nem a autenticar: escopo esquecido é bug de rota nova.
    expect(keys.autenticar).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'api_publica.rota_sem_escopo' }),
    );
  });

  it('recusa requisição sem Bearer, e sem tocar a máquina de chave', async () => {
    await expect(
      guard.canActivate(contextoHttp({ headers: {} })),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      guard.canActivate(contextoHttp({ headers: { authorization: 'crm_x' } })),
    ).rejects.toThrow(UnauthorizedException);

    expect(keys.autenticar).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ evento: 'api_publica.credencial_ausente' }),
    );
  });

  it('nunca escreve o valor recebido no log', async () => {
    await guard
      .canActivate(contextoHttp({ headers: { authorization: 'crm_segredo' } }))
      .catch(() => undefined);
    reflector.getAllAndOverride.mockReturnValue(undefined);
    await guard
      .canActivate(contextoHttp({ headers: { authorization: 'crm_segredo' } }))
      .catch(() => undefined);

    const linhas = JSON.stringify([
      ...warnSpy.mock.calls,
      ...errorSpy.mock.calls,
    ]);
    expect(linhas).not.toContain('crm_segredo');
  });
});
