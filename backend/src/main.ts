// Vercel의 Nest 빌더는 node_modules를 함수에 넣지 않는다.
// 배포본은 패키지가 이미 들어 있는 번들만 실행하고, 로컬은 기존 서버를 쓴다.
if (process.env.VERCEL) {
  // @ts-ignore 배포 때 ncc가 만드는 파일이며 타입 선언이 없다.
  require('../vercel-bundle/index.js');
} else {
  require('./local-bootstrap');
}
