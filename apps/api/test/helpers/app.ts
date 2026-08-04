import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/**
 * Sobe o AppModule REAL, com duas coisas neutralizadas — e as duas por motivos
 * que já custaram tempo de depuração.
 *
 * **1. `ThrottlerGuard`.** `/auth/login` é 5/min por IP e no teste todas as
 * requisições saem do mesmo IP: o sexto login falharia por 429, não pelo que o
 * spec quer provar.
 *
 * `overrideGuard(ThrottlerGuard)` (via `.compile()`) NÃO alcança este guard: ele
 * entra no `AppModule` como `{ provide: APP_GUARD, useClass: ThrottlerGuard }`,
 * um provider multi — o `TestingModuleBuilder` substitui o provider de token
 * `ThrottlerGuard`, mas a instância que o Nest de fato invoca por requisição é
 * a do slot `APP_GUARD`, criada à parte. Confirmado batendo nisso: com
 * `overrideGuard`, o sexto login da suíte ainda voltava 429. A forma que
 * funciona sem tocar o `AppModule` de produção é no protótipo — afeta qualquer
 * instância, seja qual for o slot de DI que a criou.
 *
 * **2. Os `@Cron` agendados.** `limparBanco` faz `TRUNCATE … CASCADE` entre os
 * testes, e TRUNCATE precisa de `AccessExclusiveLock` na tabela. Enquanto isso, os
 * dois jobs de **1 minuto** (`notificacoes-dispatch` e `webhooks-owner-dispatch`)
 * varrem os outbox — o segundo com `FOR UPDATE SKIP LOCKED`, que toma lock de
 * linha. Quando as duas coisas se cruzam, o Postgres responde
 * `deadlock detected (40P01)` e o teste falha **num arquivo qualquer**, num ponto
 * qualquer, dependendo de em que segundo do minuto a suíte estava. Foi exatamente
 * o que aconteceu quando a segunda outbox entrou: a suíte passou a falhar em
 * arquivos diferentes a cada execução, sem nenhuma relação com o que mudou.
 *
 * Desarmar o agendamento é seguro porque **nenhum spec depende do cron disparar
 * sozinho**: quem testa um job o chama à mão (`app.get(AccountPurgeJob).run()`).
 * Deixar o agendador ligado não testava nada — só criava corrida com a limpeza.
 */
export async function criarAppDeTeste(): Promise<INestApplication> {
  ThrottlerGuard.prototype.canActivate = () => true;

  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  desarmarCrons(app);
  return app;
}

/**
 * Para todos os `@Cron` registrados. Depois do `init()`, porque é ele que os
 * registra — e pelo `SchedulerRegistry`, que é a API pública do
 * `@nestjs/schedule` para isso.
 */
function desarmarCrons(app: INestApplication): void {
  const registry = app.get(SchedulerRegistry, { strict: false });
  for (const [, job] of registry.getCronJobs()) {
    void job.stop();
  }
}
