import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

// Puerto del back fijado por el `.env` del repo (apps/back/.env). Lo expongo
// como variable para que el proxy de Vite preview lo levante con el mismo
// valor. Si llegara a cambiar, basta con tocar acá y BACK_PORT en el .env.
const BACK_PORT = process.env.BACK_PORT ?? '3002';
const FRONT_PORT = '4300';

const BACK_URL = `http://localhost:${BACK_PORT}`;
const FRONT_URL = `http://localhost:${FRONT_PORT}`;

// El bundle del back (`dist/apps/back/main.js`) y el del front
// (`dist/apps/front`) deben existir antes de correr. Los targets de
// Playwright dependen de los builds vía `implicitDependencies` del
// project.json; en CI invocá `nx run-many -t build` antes de `nx e2e`.
const BACK_ENTRY = resolve(__dirname, '../../dist/apps/back/main.js');

export default defineConfig({
  testDir: './src',
  // Carpeta donde el setup deposita los storageStates por rol. Ignorada
  // por git — se regenera en cada corrida del proyecto `setup`.
  outputDir: '../../dist/.playwright/apps/front-e2e/output',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Un solo worker mientras compartamos una DB y un tenant: evitamos races
  // entre suites (p. ej. admin que recrea áreas mientras agentes operan).
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: FRONT_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /.*\.setup\.ts$/,
    },
  ],
  webServer: [
    {
      // Back: bundle de prod (cero watchers). El `SEED_E2E_USERS=true`
      // crea lider/agente/empleado al boot. Las demás variables vienen
      // del `apps/back/.env` — Nest lo carga con path relativo al cwd,
      // así que el cwd debe ser la raíz del monorepo.
      command: `node ${BACK_ENTRY}`,
      url: `${BACK_URL}/api/v1/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: resolve(__dirname, '../..'),
      env: {
        PORT: BACK_PORT,
        SEED_E2E_USERS: 'true',
        SWAGGER_ENABLED: 'false',
        LOG_LEVEL: 'warn',
        // Las suites hacen ráfagas de logins/refreshes que disparan el
        // throttler (incluidos los decoradores `@Throttle` del auth
        // controller, que son literales y no leen de env). El bypass se
        // activa con esta flag y solo aplica al boot del back en E2E.
        E2E_NO_THROTTLE: 'true',
        // Sin API key el cliente LLM queda deshabilitado y los jobs de
        // clasificación caen al fallback humano. Evita timing races con
        // la IA mientras los specs de tickets ejercitan el flujo manual.
        // Si más adelante hace falta una suite específica de IA, se
        // configura aparte con su propia env.
        LLM_API_KEY: '',
      },
    },
    {
      // Front: `vite preview` sirve el bundle estático y proxea `/api`
      // al back (ver vite.config.ts > preview.proxy).
      command: `pnpm exec nx preview front`,
      url: FRONT_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      stdout: 'pipe',
      stderr: 'pipe',
      cwd: resolve(__dirname, '../..'),
      env: {
        BACK_PORT,
      },
    },
  ],
});
