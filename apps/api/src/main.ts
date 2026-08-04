import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { JsonLogger } from './shared/logging/json-logger';
import { registrarLog } from './shared/logging/log';
import { contextoDaRequisicao } from './shared/logging/request-context.middleware';
import { ValidationPipeEmPtBr } from './shared/validation/validacao-em-pt-br';

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

/**
 * Contrato de máquina da API PÚBLICA — e só dela.
 *
 * `include: [PublicApiModule]` é a linha que importa: sem ela o documento traria
 * as 200+ rotas internas, publicando a superfície inteira do CRM a quem só
 * precisa criar um cliente. É uma decisão de segurança, não de estética.
 *
 * Só o JSON, sem Swagger UI (`swaggerUiEnabled: false`): a UI arrastaria briga
 * com o CSP do helmet e duplicaria `/ajuda/api`, que é onde a documentação
 * legível mora.
 *
 * Roda DEPOIS do `setGlobalPrefix('api/v1')`, então os caminhos do documento já
 * saem prefixados — e é por isso que o `jsonDocumentUrl` é declarado com o
 * prefixo inteiro à mão: ele é uma rota de Express, não uma rota do Nest.
 */
function publicarContratoDaApiPublica(app: NestExpressApplication): void {
  const openapi = new DocumentBuilder()
    .setTitle('API pública do CRM ProgrameAi')
    .setDescription(
      'Escrita servidor a servidor por chave de integração. Autenticação: ' +
        'cabeçalho Authorization: Bearer com a chave (crm_…). Cada rota exige um ' +
        'escopo próprio da chave. Só escrita: não há GET nesta superfície.',
    )
    .setVersion('1')
    // `bearerFormat` explícito: o default do DocumentBuilder é "JWT", e a
    // credencial aqui NÃO é um JWT — é a chave de integração opaca. Deixar o
    // default faria o documento mentir sobre o que colar no cabeçalho.
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'crm_<64 hex>',
        description:
          'Chave de integração emitida em Administração → API. Aparece uma ' +
          'única vez na criação; quem perde rotaciona.',
      },
      'chaveDeIntegracao',
    )
    .build();
  SwaggerModule.setup(
    'api/v1/public/docs',
    app,
    () =>
      SwaggerModule.createDocument(app, openapi, {
        include: [PublicApiModule],
      }),
    {
      swaggerUiEnabled: false,
      jsonDocumentUrl: 'api/v1/public/openapi.json',
    },
  );
}

async function bootstrap() {
  capturarErrosDoProcesso();
  // rawBody: true mantém o parser JSON das demais rotas e expõe req.rawBody
  // (Buffer), necessário para stripe.webhooks.constructEvent no webhook Stripe.
  // logger: JsonLogger troca o console colorido do Nest por uma linha JSON por
  // evento — o formato que a stack de observabilidade da VPS indexa.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: new JsonLogger(),
  });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
  // Atrás de um reverse proxy, a conexão TCP vem do proxy: sem isto req.ip é o
  // IP do container do Traefik, e como o getTracker default do ThrottlerGuard é
  // `return req.ip`, o @Throttle de /auth/* viraria um balde ÚNICO compartilhado
  // por todos os clientes — 5 logins/min derrubariam o login de todo mundo. O
  // mesmo req.ip vai como `remoteip` ao Turnstile.
  app.set('trust proxy', config.get<number>('TRUST_PROXY_HOPS') ?? 1);
  // Primeiro middleware da cadeia: define o requestId que todas as linhas de log
  // daquele acesso (inclusive as do próprio Nest) vão carregar.
  app.use(contextoDaRequisicao);
  // A API responde em /api, que o Traefik roteia DIRETO ao Nest: estas respostas
  // não passam pelo nginx do front (apps/web/nginx.conf) e sairiam sem cabeçalho
  // de segurança algum. O CSP default do helmet é inócuo numa API que só devolve
  // JSON, e não conflita com o CSP do front — são caminhos diferentes (/ vs /api).
  // hsts: false porque HSTS é política de HOST, não de path: o navegador guarda a
  // última que recebeu daquele host, e o nginx do front já manda
  // `max-age=31536000` sem includeSubDomains (nginx.conf:70). Ligar o default do
  // helmet aqui criaria duas políticas divergentes para o mesmo host, decididas
  // pela ordem das respostas — e includeSubDomains fica travado por um ano.
  app.use(helmet({ hsts: false }));
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipeEmPtBr({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: config.get<string>('FRONTEND_URL'),
    credentials: true,
  });
  publicarContratoDaApiPublica(app);
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
