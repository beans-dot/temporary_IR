// require("@nestjs/core")
// Vercel의 Nest 빌더는 node_modules를 함수에 넣지 않는다.
// 배포본은 패키지가 이미 들어 있는 번들만 실행하고, 로컬은 기존 서버를 쓴다.
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

function listTaskFiles(dir: string, depth = 0): string[] {
  if (depth > 2) return [];
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return [`${dir} (unreadable)`];
  }
  const lines: string[] = [];
  for (const name of names.slice(0, 40)) {
    const full = join(dir, name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    lines.push(`${'  '.repeat(depth)}${name}${isDir ? '/' : ''}`);
    if (isDir) lines.push(...listTaskFiles(full, depth + 1));
  }
  return lines;
}

if (process.env.VERCEL) {
  const failures: string[] = [];
  const load = (loader: () => void, label: string) => {
    try {
      loader();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${label}: ${message}`);
      return false;
    }
  };
  const started =
    load(() => require('./backend/vercel-bundle/index.js'), 'backend') ||
    load(() => require('./vercel-bundle/index.js'), 'same') ||
    load(() => require('../vercel-bundle/index.js'), 'parent') ||
    load(() => require('./src/vercel-bundle/index.js'), 'src');
  if (!started) {
    throw new Error(
      `${failures.join('\n')}\n/var/task:\n${listTaskFiles('/var/task').join('\n')}`,
    );
  }
} else {
  require('./local-bootstrap');
}
