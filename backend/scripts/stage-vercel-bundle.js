const { copyFileSync } = require('fs');

copyFileSync('vercel-bundle/index.js', 'src/vercel-bundle.js');
