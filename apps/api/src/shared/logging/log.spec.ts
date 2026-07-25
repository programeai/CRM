import { registrarLog } from './log';

/** Captura as linhas escritas no stdout e as devolve já desserializadas. */
function capturarStdout() {
  const linhas: Record<string, unknown>[] = [];
  const spy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((texto: unknown) => {
      linhas.push(JSON.parse(String(texto)) as Record<string, unknown>);
      return true;
    });
  return { linhas, restaurar: () => spy.mockRestore() };
}

describe('registrarLog', () => {
  let stdout: ReturnType<typeof capturarStdout>;
  const ambienteOriginal = process.env.NODE_ENV;

  beforeEach(() => {
    stdout = capturarStdout();
  });

  afterEach(() => {
    stdout.restaurar();
    process.env.NODE_ENV = ambienteOriginal;
  });

  it('escreve uma linha JSON com level, time e evento', () => {
    registrarLog('info', { evento: 'teste.ok', msg: 'tudo certo', ms: 12 });

    expect(stdout.linhas).toHaveLength(1);
    expect(stdout.linhas[0]).toMatchObject({
      level: 'info',
      evento: 'teste.ok',
      msg: 'tudo certo',
      ms: 12,
    });
    expect(String(stdout.linhas[0].time)).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
  });

  it('redige valores de chaves sensíveis, inclusive aninhadas', () => {
    registrarLog('warn', {
      evento: 'teste.segredo',
      password: 'p4ssw0rd',
      cabecalhos: { authorization: 'Bearer abc', accept: 'application/json' },
      usuario: { email: 'a@b.com', passwordHash: '$argon2id$x' },
    });

    expect(stdout.linhas[0]).toMatchObject({
      password: '[redigido]',
      cabecalhos: { authorization: '[redigido]', accept: 'application/json' },
      usuario: { email: 'a@b.com', passwordHash: '[redigido]' },
    });
  });

  it('não emite debug em produção', () => {
    process.env.NODE_ENV = 'production';
    registrarLog('debug', { evento: 'teste.debug' });
    expect(stdout.linhas).toHaveLength(0);

    process.env.NODE_ENV = 'development';
    registrarLog('debug', { evento: 'teste.debug' });
    expect(stdout.linhas).toHaveLength(1);
  });

  // O limite de profundidade da redação é o que segura referência circular:
  // sem ele o JSON.stringify estouraria e a linha se perderia.
  it('sobrevive a objeto com referência circular', () => {
    const circular: Record<string, unknown> = {};
    circular.eu = circular;

    registrarLog('error', { evento: 'teste.circular', circular });

    expect(stdout.linhas).toHaveLength(1);
    expect(stdout.linhas[0]).toMatchObject({
      level: 'error',
      evento: 'teste.circular',
    });
  });

  it('serializa Error com mensagem e stack em vez de objeto vazio', () => {
    registrarLog('error', { evento: 'teste.erro', erro: new Error('quebrou') });

    expect(stdout.linhas[0].erro).toMatchObject({ msg: 'quebrou' });
    expect((stdout.linhas[0].erro as { stack: string }).stack).toContain(
      'Error: quebrou',
    );
  });
});
