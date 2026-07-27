import type { ConfigService } from '@nestjs/config';
import type { ClsService } from 'nestjs-cls';
import { PrismaService, PRISMA_TX, type PrismaTx } from './prisma.service';
import { PrismaAdminService } from './prisma-admin.service';

/**
 * ESTE SPEC NÃO MOCKA O `PrismaService` — de propósito, e é o único do projeto
 * assim. Todos os outros mockam, o que é certo: eles testam regra de negócio, e
 * subir Prisma de verdade em cada um só deixaria a suíte lenta.
 *
 * O buraco que isso deixava era o próprio `PrismaService`: como ninguém o
 * construía, `db` podia devolver um objeto sem os delegates de model e a suíte
 * inteira passava verde enquanto login, registro, refresh, OAuth e reset de
 * senha respondiam 500 em produção — foi exatamente o que aconteceu (o getter
 * devolvia `this`, que dentro de um getter da subclasse é o alvo cru do Proxy
 * do PrismaClient, não o Proxy).
 *
 * Não precisa de banco: o `PrismaClient` é lazy e só abre conexão na primeira
 * query. Aqui nada consulta nada — nem `onModuleInit`/`$connect` são chamados.
 */

/** Lista os delegates de model expostos por um client (ignora `$…` e internos). */
function delegatesDeModel(client: object): string[] {
  return Object.keys(client)
    .filter((k) => !k.startsWith('$') && !k.startsWith('_'))
    .sort();
}

const URL_FAKE =
  'postgresql://usuario:senha@localhost:5432/banco?schema=public';
const configFake = { getOrThrow: () => URL_FAKE } as unknown as ConfigService;

describe('PrismaService', () => {
  let cls: { get: jest.Mock };
  let service: PrismaService;

  beforeEach(() => {
    cls = { get: jest.fn().mockReturnValue(undefined) };
    service = new PrismaService(configFake, cls as unknown as ClsService);
  });

  describe('db fora de transação (rota pública)', () => {
    it('expõe os delegates de model — sem eles, todo /auth/* quebra', () => {
      const db = service.db;

      // `session` é o delegate que o login usa (SessionsService.create); `user`
      // é o que registro e reset de senha usam. Citados por nome porque foram
      // os que quebraram — se um sumir, o erro aponta direto para a rota.
      expect(db.session).toBeDefined();
      expect(typeof db.session.create).toBe('function');
      expect(db.user).toBeDefined();
      expect(typeof db.user.findUnique).toBe('function');
    });

    it('expõe o MESMO conjunto de delegates que o client injetado', () => {
      // Generaliza o caso acima: qualquer model do schema alcançável via
      // `prismaService.x` tem de estar alcançável via `prismaService.db.x`.
      // É esta asserção que pega a regressão em model novo, sem editar o spec.
      expect(delegatesDeModel(service.db)).toEqual(delegatesDeModel(service));
      expect(delegatesDeModel(service.db).length).toBeGreaterThan(0);
    });
  });

  describe('db dentro de transação (rota autenticada)', () => {
    it('devolve o tx do CLS, e não o client base', () => {
      const tx = { session: { create: jest.fn() } } as unknown as PrismaTx;
      cls.get.mockReturnValue(tx);

      expect(service.db).toBe(tx);
      expect(cls.get).toHaveBeenCalledWith(PRISMA_TX);
    });
  });
});

describe('PrismaAdminService', () => {
  // Hoje o admin client é acessado direto (`admin.user…`), então passa pelo
  // Proxy e está a salvo. A trava existe para o dia em que alguém adicionar um
  // getter aqui e repetir a armadilha do `this`.
  it('expõe os delegates de model', () => {
    const admin = new PrismaAdminService(configFake);

    expect(typeof admin.user.findUnique).toBe('function');
    expect(delegatesDeModel(admin).length).toBeGreaterThan(0);
  });
});
