import { defineConfig } from 'vite';

// base: './' keeps every asset path relative so the build works from any sub-path
// (GitHub Pages project sites, local static servers, Quest browser via adb reverse).
export default defineConfig({
  base: './',
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    sourcemap: false,
  },
});
