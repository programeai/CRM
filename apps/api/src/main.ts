import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  // rawBody: true mantém o parser JSON das demais rotas e expõe req.rawBody
  // (Buffer), necessário para stripe.webhooks.constructEvent no webhook Stripe.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  app.setGlobalPrefix('api/v1');
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
  await app.listen(config.get<number>('PORT') ?? 3000);
}
void bootstrap();
