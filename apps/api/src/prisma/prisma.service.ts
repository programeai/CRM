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

  /**
   * Roda `fn` sob o contexto de RLS de um owner, na mão. É o gêmeo do
   * `OwnerContextInterceptor` para a rota que **não tem `req.user`** e ainda
   * assim escreve em tabela com RLS: hoje só a ingestão externa de lead
   * (`POST /leads/intake`, autenticada por token de integração).
   *
   * Mesma mecânica do interceptor — transação, `set_config` como primeira
   * statement, `tx` no CLS — e as mesmas duas obrigações de quem chama:
   *
   *  1. O `ownerId` vem de onde a ROTA autenticou (o token da integração),
   *     **nunca** do corpo da requisição. Aceitar owner pelo corpo transforma
   *     uma rota pública em "escreva na conta de quem você quiser".
   *  2. Nada de I/O de rede aqui dentro: a transação usa o timeout default do
   *     Prisma (5s), e a entrega de e-mail/webhook acontece depois do commit
   *     (ver `NotificationsDispatchJob`).
   *
   * Não use isto para contornar o interceptor em rota autenticada.
   */
  async executarComoOwner<T>(
    ownerId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const anterior = this.cls.get<PrismaTx>(PRISMA_TX);
    try {
      return await this.base.$transaction(async (tx) => {
        // set_config seguro: valor via bound param (nunca concatenar/interpolar).
        await tx.$executeRaw`SELECT set_config('app.owner_id', ${ownerId}, true)`;
        this.cls.set(PRISMA_TX, tx);
        return fn();
      });
    } finally {
      // Devolve o CLS ao que era. Sem isto, o `tx` JÁ FECHADO continuaria no
      // contexto e a próxima consulta do mesmo request estouraria — diferente do
      // interceptor, aqui a requisição costuma seguir depois do commit (é onde a
      // notificação sai, de propósito: só se avisa o que já está gravado).
      this.cls.set(PRISMA_TX, anterior);
    }
  }
}
