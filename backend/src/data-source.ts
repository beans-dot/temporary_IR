import 'reflect-metadata';
import './config/load-env';
import { DataSource } from 'typeorm';
import { buildPostgresOptions } from './config/typeorm.config';

// 시딩 스크립트 및 TypeORM CLI에서 사용하는 독립 DataSource
export const AppDataSource = new DataSource(buildPostgresOptions());
