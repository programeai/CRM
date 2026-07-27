import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { ClsService } from 'nestjs-cls';

export const PRISMA_TX = 'PRISMA_TX';
export type PrismaTx = Prisma.TransactionClient;

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  /**
   * O client base, já proxiado — ver o porquê em `db`. Preenchido no construtor
   * porque é lá, logo após o `super()`, que `this` ainda é o Proxy.
   */
  private readonly base: PrismaClient;

  constructor(
    config: ConfigService,
    private readonly cls: ClsService,
  ) {
    // Conecta como crm_app (NOSUPERUSER/NOBYPASSRLS) → sujeito ao RLS.
    super({
      datasources: {
        db: { url: config.getOrThrow<string>('APP_DATABASE_URL') },
      },
    });
    this.base = this;
  }

  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Client a usar nos repositórios: a transação do request (com `app.owner_id`
   * setado pelo OwnerContextInterceptor, via CLS) ou o client base quando não
   * há request (ex.: bootstrap). Sem contexto de owner, as tabelas com RLS
   * respondem fail-closed (zero linhas).
   *
   * Devolve `this.base`, nunca `this`: o `PrismaClient` entrega um Proxy cujo
   * trap `get` não repassa o receiver, então dentro de um getter da subclasse
   * `this` é o alvo cru — que não tem os delegates de model. Retornar `this`
   * aqui fazia `db.session` virar `undefined` em toda rota pública (login,
   * registro, refresh, OAuth, reset de senha), as únicas que rodam fora da
   * transação do interceptor.
   */
  get db(): PrismaTx | PrismaClient {
    return this.cls.get<PrismaTx>(PRISMA_TX) ?? this.base;
  }
}
