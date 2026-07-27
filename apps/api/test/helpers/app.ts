import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';

/**
 * Sobe o AppModule REAL. O ThrottlerGuard é o único neutralizado: `/auth/login`
 * é 5/min por IP e no teste todas as requisições saem do mesmo IP — o sexto
 * login falharia por 429, não pelo que o spec quer provar.
 *
 * `overrideGuard(ThrottlerGuard)` (via `.compile()`) NÃO alcança este guard: ele
 * entra no `AppModule` como `{ provide: APP_GUARD, useClass: ThrottlerGuard }`,
 * um provider multi — o `TestingModuleBuilder` substitui o provider de token
 * `ThrottlerGuard`, mas a instância que o Nest de fato invoca por requisição é
 * a do slot `APP_GUARD`, criada à parte. Confirmado batendo nisso: com
 * `overrideGuard`, o sexto login da suíte ainda voltava 429. A forma que
 * funciona sem tocar o `AppModule` de produção é no protótipo — afeta qualquer
 * instância, seja qual for o slot de DI que a criou.
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
  return app;
}
