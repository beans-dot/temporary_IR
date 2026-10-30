// require("@nestjs/core")
// Vercel의 Nest 빌더는 node_modules를 함수에 넣지 않는다.
// 배포본은 패키지가 이미 들어 있는 번들만 실행하고, 로컬은 기존 서버를 쓴다.
if (process.env.VERCEL) {
  require('./vercel-bundle.js');
} else {
  require('./local-bootstrap');
}
