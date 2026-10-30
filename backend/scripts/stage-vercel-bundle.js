const { copyFileSync } = require('fs');

// Nest 빌드 결과가 함수 루트가 된다. main.js 옆에서 require 되도록 dist에 둔다.
copyFileSync('vercel-bundle/index.js', 'dist/vercel-bundle.js');
