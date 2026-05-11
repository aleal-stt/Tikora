import { expect, test } from '@playwright/test';
import { storageStateFor } from '../fixtures';

// Usamos el rol agente para no interferir con suites de admin que pueden
// rotar passwords o desactivar usuarios. Cualquier rol autenticado sirve.
test.use({ storageState: storageStateFor('agente') });

test('logout vuelve a /login e invalida el refresh token', async ({ page, context }) => {
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/);

  await page.getByRole('button', { name: /salir/i }).click();
  await expect(page).toHaveURL(/\/login/);

  // El back debió limpiar la cookie httpOnly. Confirmamos que el refresh
  // ya no funciona — sin cookie válida, 401.
  const refresh = await context.request.post('/api/v1/auth/refresh');
  expect(refresh.status()).toBe(401);
});
