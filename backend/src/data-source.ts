import 'reflect-metadata';
import './config/load-env';
import { DataSource } from 'typeorm';
import * as entities from './entities';

// 시딩 스크립트 및 TypeORM CLI에서 사용하는 독립 DataSource
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'ir_user',
  password: process.env.DB_PASSWORD || 'ir_password',
  database: process.env.DB_DATABASE || 'ir_dashboard',
  entities: Object.values(entities),
  synchronize: true,
  logging: process.env.DB_LOGGING === 'true',
});
