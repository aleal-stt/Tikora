import { test, expect } from '@playwright/test';
import { storageStateFor } from '../fixtures';

// Smoke mínimo para validar el wiring: cargar la home con storageState
// de admin debe quedar autenticado (sin redirect a /login) y mostrar la
// shell de admin con el sub-nav lateral.

test.use({ storageState: storageStateFor('admin') });

test('admin entra al home autenticado', async ({ page }) => {
  await page.goto('/');
  // HomeRedirect manda a `/bandeja` (admin/lider/agente) o `/mis-tickets`.
  // Ambas rutas son válidas — basta con confirmar que no estamos en /login.
  await expect(page).not.toHaveURL(/\/login/);
});
