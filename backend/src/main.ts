import './config/load-env';
import { createServer } from 'http';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

function redact(value: string): string {
  return value.replace(/(\/\/[^/\s:@]+):([^@\s]+)@/g, '$1:***@');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function listenFallback(port: number, error: unknown): Promise<void> {
  const detail = redact(
    error instanceof Error ? error.stack || error.message : String(error),
  ).slice(0, 1500);
  const html = `<!doctype html>
<html lang="ko">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>YSU IR API</title>
<body style="font-family: sans-serif; max-width: 40rem; margin: 3rem auto; padding: 0 1rem; line-height: 1.5">
  <h1>API가 데이터베이스에 연결되지 않았습니다</h1>
  <p>이 주소는 화면이 아니라 API 서버입니다. Vercel은 개발 PC의 PostgreSQL에 닿을 수 없어서 서버가 켜지지 않았습니다.</p>
  <p>Vercel 프로젝트 환경 변수에 호스팅된 Postgres 연결을 넣은 뒤 다시 배포하세요.</p>
  <ul>
    <li><code>DATABASE_URL</code> 또는 <code>POSTGRES_URL</code></li>
    <li>또는 <code>DB_HOST</code>, <code>DB_PORT</code>, <code>DB_USERNAME</code>, <code>DB_PASSWORD</code>, <code>DB_DATABASE</code></li>
    <li><code>JWT_SECRET</code></li>
  </ul>
  <pre style="white-space: pre-wrap; background: #f4f4f5; padding: 1rem">${escapeHtml(detail)}</pre>
</body>
</html>`;

  const server = createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(port, () => resolve());
  });
}

async function bootstrap() {
  const port = parseInt(process.env.PORT || '4000', 10);
  try {
    const app = await NestFactory.create(AppModule, { bodyParser: false });
    // 초기시딩 JSON이 기본 100kb를 넘을 수 있다.
    app.use(json({ limit: '4mb' }));
    app.use(urlencoded({ extended: true, limit: '4mb' }));

    app.setGlobalPrefix('api', {
      exclude: [{ path: '/', method: RequestMethod.GET }],
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.enableCors({
      origin: (process.env.CORS_ORIGIN || '*').split(','),
      credentials: true,
    });

    await app.listen(port);
    // eslint-disable-next-line no-console
    console.log(`[YSU-IR] Backend listening on http://localhost:${port}/api`);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[YSU-IR] bootstrap failed', redact(String(error)));
    await listenFallback(port, error);
  }
}

bootstrap();
