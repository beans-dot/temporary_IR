import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { Express } from 'express';

function redact(value: string): string {
  return value.replace(/(\/\/[^/\s:@]+):([^@\s]+)@/g, '$1:***@');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function errorText(error: unknown): string {
  const raw =
    error instanceof Error ? error.stack || error.message : String(error);
  return redact(raw).slice(0, 1500);
}

function errorHtml(detail: string): string {
  return `<!doctype html>
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
}

function hasRemoteDatabase(): boolean {
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) return true;
  const host = process.env.DB_HOST;
  if (!host) return false;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

const port = parseInt(process.env.PORT || '4000', 10);

// Vercel에는 로컬 PostgreSQL이 없다. Nest를 올리면 연결 실패가 함수를 죽인다.
if (process.env.VERCEL && !hasRemoteDatabase()) {
  const detail =
    'DB_HOST가 없거나 localhost입니다. Vercel에서는 원격 Postgres의 DATABASE_URL이 필요합니다.';
  createServer((_req, res) => {
    res.statusCode = 503;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('x-ysu-ir-boot', 'no-database');
    res.end(errorHtml(detail));
  }).listen(port);
} else {
  void bootNest(port);
}

function bootNest(listenPort: number) {
  let bootError: string | null = null;
  let expressApp: Express | null = null;

  const noteFailure = (error: unknown) => {
    if (expressApp) return;
    bootError = errorText(error);
    // eslint-disable-next-line no-console
    console.error('[YSU-IR] bootstrap failed', bootError);
  };

  process.on('uncaughtException', noteFailure);
  process.on('unhandledRejection', noteFailure);

  const ready = (async () => {
    try {
      await import('./config/load-env');
      const { default: express, json, urlencoded } = await import('express');
      const { RequestMethod, ValidationPipe } = await import('@nestjs/common');
      const { NestFactory } = await import('@nestjs/core');
      const { ExpressAdapter } = await import('@nestjs/platform-express');
      const { AppModule } = await import('./app.module');

      const appExpress = express();
      const app = await NestFactory.create(
        AppModule,
        new ExpressAdapter(appExpress),
        { bodyParser: false },
      );
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
      await app.init();
      expressApp = appExpress;
      // eslint-disable-next-line no-console
      console.log(
        `[YSU-IR] Backend listening on http://localhost:${listenPort}/api`,
      );
    } catch (error) {
      noteFailure(error);
    }
  })();

  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      await ready;
      if (bootError || !expressApp) {
        res.statusCode = 503;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(errorHtml(bootError || 'API를 시작하지 못했습니다.'));
        return;
      }
      expressApp(req, res);
    },
  );

  server.listen(listenPort);
}
