import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, storageStateFor } from '../fixtures';

// Specs de la rotación de refresh tokens. Operan a nivel API (sin UI)
// porque el comportamiento que probamos vive del lado del back.
// Sin storageState — cada test maneja su sesión.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Refresh por cookie httpOnly', () => {
  test('refresh sin cookie devuelve 401', async ({ request }) => {
    const res = await request.post('/api/v1/auth/refresh');
    expect(res.status()).toBe(401);
  });

  test('refresh con cookie válida devuelve nuevo accessToken', async ({ request }) => {
    const login = await request.post('/api/v1/auth/login', {
      data: E2E_CREDENTIALS.agente,
    });
    expect(login.ok(), `login falló: ${login.status()}`).toBeTruthy();

    const refresh = await request.post('/api/v1/auth/refresh');
    expect(refresh.ok(), `refresh falló: ${refresh.status()}`).toBeTruthy();

    const body = (await refresh.json()) as { accessToken: string };
    expect(typeof body.accessToken).toBe('string');
    expect(body.accessToken.length).toBeGreaterThan(20);
  });

  test('reutilizar un refresh ya rotado invalida toda la cadena', async ({ request, browser }) => {
    // Usamos `empleado` para no interferir con otros specs que loguean
    // como agente/admin (la invalidación de cadena revoca TODOS los
    // refresh activos del usuario, incluidos los del storageState).
    const login = await request.post('/api/v1/auth/login', {
      data: E2E_CREDENTIALS.empleado,
    });
    expect(login.ok(), `login falló: ${login.status()}`).toBeTruthy();

    // Snapshot del cookie inicial — el que va a rotar tras el primer refresh.
    const before = await request.storageState();
    const stale = before.cookies.find((c) => c.name === 'tikora.refresh');
    if (!stale) {
      throw new Error('cookie de refresh ausente tras login');
    }

    // Primer refresh: rota el cookie. `request` ahora tiene el nuevo.
    const rotated = await request.post('/api/v1/auth/refresh');
    expect(rotated.ok(), `refresh inicial falló: ${rotated.status()}`).toBeTruthy();

    // Reuse: armamos otro contexto con el cookie viejo y reintentamos.
    const reuseContext = await browser.newContext({
      storageState: { cookies: [stale], origins: [] },
    });
    const reused = await reuseContext.request.post('/api/v1/auth/refresh');
    expect(reused.status(), 'reuso del cookie viejo debería ser rechazado').toBe(401);
    await reuseContext.close();

    // Y la cadena nueva (que tenía el cookie rotado) también queda
    // revocada por la política de "revoke-all-on-reuse".
    const followUp = await request.post('/api/v1/auth/refresh');
    expect(followUp.status(), 'cadena nueva debió revocarse tras detectar reuso').toBe(401);

    // Cleanup: el revoke-all dejó inutilizable el storageState de empleado
    // generado por `auth.setup.ts`. Re-logueamos y reescribimos el archivo
    // para que las suites siguientes (tickets empleado) lo encuentren válido.
    const relogin = await request.post('/api/v1/auth/login', {
      data: E2E_CREDENTIALS.empleado,
    });
    expect(relogin.ok(), `re-login de cleanup falló: ${relogin.status()}`).toBeTruthy();
    await request.storageState({ path: storageStateFor('empleado') });
  });
});
