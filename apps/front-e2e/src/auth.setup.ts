import { test as setup, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { E2E_CREDENTIALS, STORAGE_STATE_DIR, storageStateFor, type E2eRole } from './fixtures';

// Genera el storageState (cookies de refresh httpOnly) de cada rol antes
// de las suites. El acceso usa `request.post` directo a `/api/v1/auth/login`
// — más rápido y robusto que automatizar la UI cuatro veces. Al cargar
// la app, `authBootstrap` llama `/refresh` con la cookie y repuebla el
// access token en memoria, así que los specs arrancan ya logueados.

setup.beforeAll(async () => {
  await mkdir(STORAGE_STATE_DIR, { recursive: true });
});

const ROLES: readonly E2eRole[] = ['admin', 'lider', 'agente', 'empleado'];

for (const role of ROLES) {
  setup(`autentica rol ${role}`, async ({ request }) => {
    const creds = E2E_CREDENTIALS[role];
    const response = await request.post('/api/v1/auth/login', {
      data: { email: creds.email, password: creds.password },
    });
    expect(
      response.ok(),
      `login ${role} falló: ${response.status()} ${await response.text()}`,
    ).toBeTruthy();
    await request.storageState({ path: storageStateFor(role) });
  });
}
