import { defineConfig } from 'vite';

/**
 * GitHub Pages "Deploy from a branch"용 미리 빌드한 부산 VR (busan/play/).
 * 브랜치를 빌드 없이 그대로 서비스해도 동작하도록 JS만 묶고, 지역 에셋은 ../regions/ 에서 그대로 받는다.
 *
 *   npm run build:busan-play   (busan/src 를 고치면 다시 실행해서 같이 커밋)
 */
export default defineConfig({
  root: 'busan',
  base: './',
  define: { 'import.meta.env.VITE_REGION_BASE': JSON.stringify('../regions/') },
  build: {
    outDir: 'play',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
});
