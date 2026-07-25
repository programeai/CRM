import { ConflictException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFalso(resposta: {
  status: jest.Mock;
  json: jest.Mock;
  headersSent?: boolean;
}): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getResponse: () => resposta,
      getRequest: () => ({ method: 'POST', path: '/api/v1/clients' }),
    }),
  } as unknown as ArgumentsHost;
}

describe('AllExceptionsFilter', () => {
  let json: jest.Mock;
  let status: jest.Mock;
  let resposta: { status: jest.Mock; json: jest.Mock; headersSent?: boolean };
  let linhas: Record<string, unknown>[];
  const filtro = new AllExceptionsFilter();

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn(() => ({ json }));
    resposta = { status, json, headersSent: false };
    linhas = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((texto: unknown) => {
      linhas.push(JSON.parse(String(texto)) as Record<string, unknown>);
      return true;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('preserva status e corpo das exceções de negócio, sem logar erro', () => {
    filtro.catch(
      new ConflictException('Já existe um cliente com este CNPJ.'),
      hostFalso(resposta),
    );

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 409,
        message: 'Já existe um cliente com este CNPJ.',
      }),
    );
    expect(linhas).toHaveLength(0);
  });

  it('registra erro não previsto com stack e responde 500 em pt-BR', () => {
    filtro.catch(new TypeError('x is not a function'), hostFalso(resposta));

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      level: 'error',
      evento: 'erro.nao_tratado',
      msg: 'x is not a function',
      tipo: 'TypeError',
      metodo: 'POST',
      rota: '/api/v1/clients',
      status: 500,
    });
    expect(String(linhas[0].stack)).toContain('TypeError');

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Erro interno do servidor.',
    });
  });

  it('com a resposta já iniciada, apenas registra o erro', () => {
    resposta.headersSent = true;
    filtro.catch(new Error('caiu no meio do stream'), hostFalso(resposta));

    expect(linhas).toHaveLength(1);
    expect(status).not.toHaveBeenCalled();
  });
});
