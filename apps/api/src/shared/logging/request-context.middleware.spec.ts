import type { Request, Response } from 'express';
import {
  contextoDaRequisicao,
  normalizarRota,
} from './request-context.middleware';

type ResponseFalso = Response & {
  disparaFinish: () => void;
  cabecalhos: Record<string, unknown>;
};

function respostaFalsa(statusCode: number): ResponseFalso {
  const cabecalhos: Record<string, unknown> = {};
  let finish: (() => void) | undefined;
  return {
    statusCode,
    cabecalhos,
    setHeader: (nome: string, valor: unknown) => {
      cabecalhos[nome] = valor;
    },
    on: (evento: string, cb: () => void) => {
      if (evento === 'finish') finish = cb;
    },
    disparaFinish: () => finish?.(),
  } as unknown as ResponseFalso;
}

function requisicaoFalsa(
  path: string,
  headers: Record<string, string> = {},
): Request {
  return { method: 'GET', path, headers, ip: '10.0.0.1' } as unknown as Request;
}

describe('contextoDaRequisicao', () => {
  let linhas: Record<string, unknown>[];

  beforeEach(() => {
    linhas = [];
    jest.spyOn(process.stdout, 'write').mockImplementation((texto: unknown) => {
      linhas.push(JSON.parse(String(texto)) as Record<string, unknown>);
      return true;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('gera um requestId, devolve no cabeçalho e o deixa na requisição', () => {
    const req = requisicaoFalsa('/api/v1/clients');
    const res = respostaFalsa(200);
    const next = jest.fn();

    contextoDaRequisicao(req, res, next);

    const id = res.cabecalhos['x-request-id'];
    expect(typeof id).toBe('string');
    // Mesma fonte para o CLS: é daqui que o idGenerator do AppModule copia.
    expect(req.headers['x-request-id']).toBe(id);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('reaproveita o requestId recebido e ignora valor suspeito', () => {
    const res = respostaFalsa(200);
    contextoDaRequisicao(
      requisicaoFalsa('/api/v1/clients', { 'x-request-id': 'trace-abc-123' }),
      res,
      jest.fn(),
    );
    expect(res.cabecalhos['x-request-id']).toBe('trace-abc-123');

    const outra = respostaFalsa(200);
    contextoDaRequisicao(
      requisicaoFalsa('/api/v1/clients', {
        'x-request-id': 'quebra"linha\n{"level":"error"}',
      }),
      outra,
      jest.fn(),
    );
    expect(outra.cabecalhos['x-request-id']).not.toContain('quebra');
  });

  it('loga a requisição no finish, com nível pelo status e sem query string', () => {
    const req = requisicaoFalsa('/api/v1/auth/oauth/google/callback');
    const res = respostaFalsa(500);

    contextoDaRequisicao(req, res, jest.fn());
    res.disparaFinish();

    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      level: 'error',
      evento: 'http.requisicao',
      metodo: 'GET',
      rota: '/api/v1/auth/oauth/google/callback',
      status: 500,
    });
    expect(linhas[0].requestId).toBe(res.cabecalhos['x-request-id']);
  });

  it('usa warn para 4xx e info para 2xx', () => {
    const res4xx = respostaFalsa(404);
    contextoDaRequisicao(requisicaoFalsa('/api/v1/x'), res4xx, jest.fn());
    res4xx.disparaFinish();

    const res2xx = respostaFalsa(201);
    contextoDaRequisicao(requisicaoFalsa('/api/v1/x'), res2xx, jest.fn());
    res2xx.disparaFinish();

    expect(linhas.map((l) => l.level)).toEqual(['warn', 'info']);
  });

  it('não loga o healthcheck, mas ainda marca o requestId', () => {
    const res = respostaFalsa(200);
    contextoDaRequisicao(requisicaoFalsa('/api/v1/health'), res, jest.fn());
    res.disparaFinish();

    expect(linhas).toHaveLength(0);
    expect(res.cabecalhos['x-request-id']).toBeDefined();
  });

  it('normaliza a rota e guarda o caminho cru só quando ele difere', () => {
    const req = requisicaoFalsa(
      '/api/v1/clients/2f1c9b6e-3a4d-4f7a-9c21-8b5e0d7a1234/contacts',
    );
    const res = respostaFalsa(200);

    contextoDaRequisicao(req, res, jest.fn());
    res.disparaFinish();

    expect(linhas[0]).toMatchObject({
      rota: '/api/v1/clients/:id/contacts',
      caminho: '/api/v1/clients/2f1c9b6e-3a4d-4f7a-9c21-8b5e0d7a1234/contacts',
    });
  });

  it('omite o caminho cru quando a rota não tem parâmetro', () => {
    const res = respostaFalsa(200);
    contextoDaRequisicao(requisicaoFalsa('/api/v1/clients'), res, jest.fn());
    res.disparaFinish();

    expect(linhas[0].rota).toBe('/api/v1/clients');
    expect(linhas[0]).not.toHaveProperty('caminho');
  });

  it('loga o ownerId publicado pelo AccessGuard', () => {
    const req = requisicaoFalsa('/api/v1/clients');
    (req as Request & { access?: { ownerId: string } }).access = {
      ownerId: 'own-1',
    };
    const res = respostaFalsa(200);

    contextoDaRequisicao(req, res, jest.fn());
    res.disparaFinish();

    expect(linhas[0].ownerId).toBe('own-1');
  });

  it('loga o IP que o Express resolveu em req.ip, não o cabeçalho cru', () => {
    // Em produção req.ip já vem do x-forwarded-for, porque o bootstrap configura
    // `trust proxy` (TRUST_PROXY_HOPS). O middleware não interpreta o cabeçalho:
    // ler de novo aqui seria uma segunda fonte de verdade para o mesmo dado.
    const res = respostaFalsa(200);
    contextoDaRequisicao(
      requisicaoFalsa('/api/v1/x', {
        'x-forwarded-for': '203.0.113.7, 172.18.0.2',
      }),
      res,
      jest.fn(),
    );
    res.disparaFinish();

    expect(linhas[0].ip).toBe('10.0.0.1');
  });
});

describe('normalizarRota', () => {
  it('troca uuid, número e token opaco pelo nome do parâmetro', () => {
    expect(
      normalizarRota('/api/v1/proposals/2f1c9b6e-3a4d-4f7a-9c21-8b5e0d7a1234'),
    ).toBe('/api/v1/proposals/:id');
    expect(normalizarRota('/api/v1/deals/42/move')).toBe(
      '/api/v1/deals/:n/move',
    );
    expect(
      normalizarRota(`/api/v1/collaborators/${'a1b2c3d4'.repeat(8)}/accept`),
    ).toBe('/api/v1/collaborators/:token/accept');
  });

  it('preserva os segmentos fixos, inclusive os de baixa cardinalidade', () => {
    // `google` e `permissions` distinguem uma rota da outra: normalizar isso
    // colapsaria rotas diferentes na mesma série.
    expect(normalizarRota('/api/v1/auth/oauth/google/callback')).toBe(
      '/api/v1/auth/oauth/google/callback',
    );
    expect(normalizarRota('/api/v1/roles/permissions')).toBe(
      '/api/v1/roles/permissions',
    );
  });
});
