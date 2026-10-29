import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';
import * as entities from '../entities';

function remoteHost(host: string | undefined): boolean {
  if (!host) return false;
  return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1';
}

/**
 * Vercel에는 로컬 PostgreSQL이 없다.
 * DATABASE_URL / POSTGRES_URL 이 있으면 그 접속을 쓰고, 원격 호스트는 SSL을 켠다.
 */
export function buildPostgresOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
  const host = process.env.DB_HOST || 'localhost';
  const useSsl =
    process.env.DB_SSL === 'true' ||
    (process.env.DB_SSL !== 'false' &&
      (url ? remoteHost(safeHost(url)) : remoteHost(host)));
  const ssl = useSsl ? { rejectUnauthorized: false } : false;

  const common = {
    type: 'postgres' as const,
    entities: Object.values(entities),
    synchronize: process.env.DB_SYNCHRONIZE !== 'false',
    logging: process.env.DB_LOGGING === 'true',
    ssl,
    extra: {
      connectionTimeoutMillis: 8000,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    },
  };

  if (url) {
    return { ...common, url };
  }

  return {
    ...common,
    host,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    username: process.env.DB_USERNAME || 'ir_user',
    password: process.env.DB_PASSWORD || 'ir_password',
    database: process.env.DB_DATABASE || 'ir_dashboard',
  };
}

export const buildTypeOrmOptions = (): TypeOrmModuleOptions => ({
  ...buildPostgresOptions(),
  retryAttempts: 1,
  retryDelay: 500,
});

function safeHost(connectionUrl: string): string | undefined {
  try {
    return new URL(connectionUrl).hostname;
  } catch {
    return undefined;
  }
}
