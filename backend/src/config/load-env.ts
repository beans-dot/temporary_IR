import { existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadDotenv } from 'dotenv';

/**
 * ts-node(src/config)와 빌드 결과(dist/config) 모두 저장소 루트에서 두 단계 아래다.
 * backend/src/config → backend → 저장소 루트
 * backend/dist/config → backend → 저장소 루트
 */
const backendDir = resolve(__dirname, '../..');
const repoRoot = resolve(__dirname, '../../..');

/** backend/.env 가 저장소 루트 .env 보다 우선한다. 이미 들어온 변수는 유지한다. */
export const envFilePaths = [
  resolve(backendDir, '.env'),
  resolve(repoRoot, '.env'),
].filter((filePath) => existsSync(filePath));

let loaded = false;

/**
 * 셸에 이미 있는 환경변수는 덮어쓰지 않는다.
 * 파일이 없으면 코드의 localhost 기본값을 사용한다.
 */
export function loadEnv(): void {
  if (loaded) return;
  loaded = true;
  for (const filePath of envFilePaths) {
    loadDotenv({ path: filePath });
  }
}

loadEnv();
