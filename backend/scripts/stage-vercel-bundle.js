const { copyFileSync } = require('fs');

// 빌더가 src 기준으로 묶고, 실행 파일은 dist를 함수 루트로 쓴다.
copyFileSync('vercel-bundle/index.js', 'src/vercel-bundle.js');
copyFileSync('vercel-bundle/index.js', 'dist/vercel-bundle.js');
