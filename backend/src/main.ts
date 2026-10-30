// require("@nestjs/core")
// Vercel의 Nest 빌더는 node_modules를 함수에 넣지 않는다.
// 배포본은 패키지가 이미 들어 있는 번들만 실행하고, 로컬은 기존 서버를 쓴다.
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function listTaskFiles(dir: string, depth = 0): string[] {
  if (depth > 3) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const lines: string[] = [];
  for (const name of names.slice(0, 50)) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    lines.push(`${'  '.repeat(depth)}${full}${isDir ? '/' : ''}`);
    if (isDir && name !== 'node_modules') {
      lines.push(...listTaskFiles(full, depth + 1));
    }
  }
  return lines;
}

function findBundle(dir: string, depth = 0): string | null {
  if (depth > 4) return null;
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    const full = join(dir, name);
    if (name === 'vercel-bundle.js' || name === 'index.js' && dir.includes('vercel-bundle')) {
      return full;
    }
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir && name !== 'node_modules') {
      const found = findBundle(full, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function missing(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Cannot find module');
}

if (process.env.VERCEL) {
  try {
    require('./vercel-bundle.js');
  } catch (error) {
    if (!missing(error)) throw error;
    const found = findBundle('/var/task');
    if (!found) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}\n${listTaskFiles('/var/task').join('\n')}`,
      );
    }
    require(found);
  }
} else {
  require('./local-bootstrap');
}
