import './config/load-env';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  // 초기시딩 JSON이 기본 100kb를 넘을 수 있다.
  app.use(json({ limit: '4mb' }));
  app.use(urlencoded({ extended: true, limit: '4mb' }));

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || '*').split(','),
    credentials: true,
  });

  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`[YSU-IR] Backend listening on http://localhost:${port}/api`);
}

bootstrap();
