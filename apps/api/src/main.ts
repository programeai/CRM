import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { JsonLogger } from './shared/logging/json-logger';
import { registrarLog } from './shared/logging/log';
import { contextoDaRequisicao } from './shared/logging/request-context.middleware';

/**
 * Erros fora do ciclo de requisição (timer, listener, promessa solta) não passam
 * por filtro de exceção nenhum: sem estes dois handlers o processo morre — ou
 * segue vivo e quebrado — sem deixar linha no log.
 */
function capturarErrosDoProcesso() {
  process.on('unhandledRejection', (motivo) => {
    registrarLog('error', {
      evento: 'processo.promessa_rejeitada',
      msg: motivo instanceof Error ? motivo.message : String(motivo),
      stack: motivo instanceof Error ? motivo.stack : undefined,
    });
  });

  process.on('uncaughtException', (erro) => {
    registrarLog('error', {
      evento: 'processo.excecao_nao_capturada',
      msg: erro.message,
      stack: erro.stack,
    });
    // O estado do processo é indefinido a partir daqui: melhor cair e deixar o
    // `restart: unless-stopped` subir de novo. A folga antes do exit é porque o
    // stdout do container é um pipe (escrita assíncrona) — sem ela a linha de
    // log acima pode ser perdida justamente no erro mais importante.
    setTimeout(() => process.exit(1), 200).unref();
  });
}

async function bootstrap() {
  capturarErrosDoProcesso();
  // rawBody: true mantém o parser JSON das demais rotas e expõe req.rawBody
  // (Buffer), necessário para stripe.webhooks.constructEvent no webhook Stripe.
  // logger: JsonLogger troca o console colorido do Nest por uma linha JSON por
  // evento — o formato que a stack de observabilidade da VPS indexa.
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: new JsonLogger(),
  });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  // Primeiro middleware da cadeia: define o requestId que todas as linhas de log
  // daquele acesso (inclusive as do próprio Nest) vão carregar.
  app.use(contextoDaRequisicao);
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
  });
  const porta = config.get<number>('PORT') ?? 3000;
  await app.listen(porta);
  registrarLog('info', {
    evento: 'app.iniciada',
    msg: 'API pronta para receber requisições.',
    porta,
    ambiente: config.get<string>('NODE_ENV'),
  });
}

void bootstrap().catch((erro: unknown) => {
  registrarLog('error', {
    evento: 'app.falhou_ao_iniciar',
    msg: erro instanceof Error ? erro.message : String(erro),
    stack: erro instanceof Error ? erro.stack : undefined,
  });
  setTimeout(() => process.exit(1), 200).unref();
});
