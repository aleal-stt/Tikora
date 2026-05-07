/// <reference types='vitest' />
import { defineConfig } from 'vite';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import swc from 'unplugin-swc';

// `unplugin-swc` reemplaza al transformer de esbuild para que los tests
// de Vitest emitan metadata de decoradores — Mongoose y NestJS la usan
// para resolver tipos de @Prop y constructor params en tiempo de carga.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/back',
  plugins: [nxViteTsPaths(), swc.vite({ module: { type: 'es6' } })],
  test: {
    watch: false,
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/back',
      provider: 'v8' as const,
    },
  },
}));
