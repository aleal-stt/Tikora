import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, type E2eRole } from '../fixtures';

// Login UI desde cero — sin storageState para ejercitar el flujo real.
test.use({ storageState: { cookies: [], origins: [] } });

const ROLES: readonly E2eRole[] = ['admin', 'lider', 'agente', 'empleado'];

test.describe('Login UI', () => {
  for (const role of ROLES) {
    test(`login válido como ${role} entra a la app`, async ({ page }) => {
      const creds = E2E_CREDENTIALS[role];

      await page.goto('/login');
      await page.getByLabel('Email').fill(creds.email);
      await page.getByLabel('Contraseña').fill(creds.password);
      await page.getByRole('button', { name: 'Ingresar' }).click();

      await expect(page).not.toHaveURL(/\/login/);
      // El header del shell expone el email — confirma que la sesión
      // está poblada con el usuario correcto, no solo que se navegó.
      // Scopear al header evita matches duplicados con avatares o tooltips.
      await expect(page.getByRole('banner').getByText(creds.email)).toBeVisible();
    });
  }

  test('email malformado bloquea el submit en el cliente', async ({ page }) => {
    // Espía las requests a /auth/login para confirmar que la validación
    // del cliente bloquea el submit antes de pegarle al back. No nos
    // acoplamos al wording exacto del error inline (Zod v4 ignora el
    // `{ message }` que pasamos al `z.email()`); la propiedad relevante
    // es que el back nunca recibió la credencial mal formada.
    let backCalls = 0;
    await page.route('**/api/v1/auth/login', (route) => {
      backCalls += 1;
      return route.continue();
    });

    await page.goto('/login');
    await page.getByLabel('Email').fill('no-es-email');
    await page.getByLabel('Contraseña').fill('cualquier-password');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    // Damos tiempo a que el submit hubiera disparado el fetch si la
    // validación no bloqueara. 500ms alcanza — la mutación es síncrona.
    await page.waitForTimeout(500);

    expect(backCalls, 'el cliente debió bloquear el submit del email inválido').toBe(0);
    await expect(page).toHaveURL(/\/login/);
  });

  test('credenciales inválidas muestran toast y mantienen el form', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill('admin@empresa.com');
    await page.getByLabel('Contraseña').fill('PasswordEquivocadaXYZ');
    await page.getByRole('button', { name: 'Ingresar' }).click();

    // El toast de sonner expone el mensaje genérico o el del back; ambos
    // referencian la sesión/contraseña. Aceptamos cualquiera para no
    // acoplar al wording exacto.
    await expect(page.getByText(/sesión|contraseña|credenciales/i).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});
