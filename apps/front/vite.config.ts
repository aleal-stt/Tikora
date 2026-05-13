/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/front',
  server: {
    port: 5173,
    host: 'localhost',
    proxy: {
      '/api': {
        // Puerto del back configurable por env. Default 3002 porque es el
        // valor que usa el `.env` real del repo; el `.env.example` aún
        // muestra 3001 como referencia histórica. Override con `BACK_PORT`.
        target: `http://localhost:${process.env.BACK_PORT ?? '3002'}`,
        changeOrigin: true,
      },
    },
    // En sistemas con `fs.inotify.max_user_watches` bajo (WSL, contenedores,
    // algunas distros) Vite revienta con ENOSPC al arrancar. Polling cuesta
    // ~5% más de CPU que el watcher nativo pero arranca siempre. Se desactiva
    // con `VITE_USE_POLLING=false` cuando el sistema soporta inotify.
    watch: {
      usePolling: process.env.VITE_USE_POLLING !== 'false',
      interval: 500,
    },
  },
  preview: {
    port: 4300,
    host: 'localhost',
    // Espeja el proxy del modo `server` para que el bundle de producción
    // pueda llamar a `/api/...` (incluida la cookie httpOnly de refresh)
    // sin tocar CORS. Usado por la suite E2E de Playwright y por probar
    // el bundle localmente.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.BACK_PORT ?? '3002'}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [react(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },
  build: {
    outDir: '../../dist/apps/front',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  test: {
    watch: false,
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/front',
      provider: 'v8' as const,
    },
  },
}));
