/**
 * 부산 VR 지역 에셋(busan/regions)을 빌드 결과(dist/busan/regions)로 복사한다.
 * 에셋은 번들에 넣지 않고 페이지 기준 ./regions/ 에서 받기 때문에 필요하다.
 */
import { cpSync, existsSync } from 'node:fs';

if (existsSync('busan/regions')) {
  cpSync('busan/regions', 'dist/busan/regions', { recursive: true });
  console.log('busan/regions → dist/busan/regions');
}
