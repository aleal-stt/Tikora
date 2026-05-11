import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, getAccessToken } from '../fixtures';

// Suite admin: ejercita los flujos de gestión desde la UI (áreas y
// usuarios). No usamos `describe.serial` porque los dos tests son
// independientes — cada uno arranca su propio nombre único.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context }) => {
  const response = await context.request.post('/api/v1/auth/login', {
    data: E2E_CREDENTIALS.admin,
  });
  if (!response.ok()) {
    throw new Error(`pre-login admin falló: ${response.status()}`);
  }
});

test.describe('Admin UI', () => {
  test('crea un área desde el form y aparece en la lista', async ({ page, request }) => {
    const nombre = `Área E2E ${Date.now()}`;

    await page.goto('/admin/areas');
    await page.getByRole('button', { name: 'Nueva área' }).click();

    await page.getByLabel('Nombre').fill(nombre);
    await page.getByLabel('Descripción').fill('Área creada por suite E2E admin.');

    // Los inputs de SLA no tienen `htmlFor` asociado — los ubicamos
    // por el fieldset que los agrupa y por orden (alta/media/baja).
    const slas = page.locator('fieldset', { hasText: 'SLAs por defecto' });
    await slas.locator('input[type="number"]').nth(0).fill('4');
    await slas.locator('input[type="number"]').nth(1).fill('24');
    await slas.locator('input[type="number"]').nth(2).fill('48');

    await page.getByRole('button', { name: 'Crear área' }).click();

    await expect(page.getByText(/área creada/i).first()).toBeVisible();
    await expect(page.getByText(nombre)).toBeVisible();

    // Verificación API: el área existe con los SLA correctos.
    const token = await getAccessToken(request, 'admin');
    const list = await request.get('/api/v1/areas?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(list.ok()).toBeTruthy();
    const body = (await list.json()) as {
      items: Array<{ name: string; slas: { alta: number; media: number; baja: number } }>;
    };
    const created = body.items.find((a) => a.name === nombre);
    expect(created).toBeDefined();
    expect(created?.slas).toEqual({ alta: 4, media: 24, baja: 48 });
  });

  test('crea un usuario empleado y aparece en la lista', async ({ page, request }) => {
    const stamp = Date.now();
    const email = `empleado.e2e.${stamp}@empresa.com`;
    const fullName = `Empleado E2E ${stamp}`;

    await page.goto('/admin/usuarios');
    await page.getByRole('button', { name: 'Nuevo usuario' }).click();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Nombre completo').fill(fullName);

    // El rol viene preseteado en `empleado` por defecto del form — no
    // hace falta tocar el Select para este flujo. Los specs que prueben
    // cambio de rol deberían interactuar con el Radix Select aparte.
    await page.getByLabel('Contraseña temporal').fill('TempPass123!');

    await page.getByRole('button', { name: 'Crear usuario' }).click();

    await expect(page.getByText(/usuario creado/i).first()).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();

    // Cleanup: desactivar el usuario vía API para no acumular activos.
    // Confirma también que el endpoint PATCH /users/:id funciona.
    const token = await getAccessToken(request, 'admin');
    const usersList = await request.get('/api/v1/users?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      usersList.ok(),
      `listado falló: ${usersList.status()} ${await usersList.text()}`,
    ).toBeTruthy();
    const usersBody = (await usersList.json()) as {
      items: Array<{ id: string; email: string }>;
    };
    const created = usersBody.items.find((u) => u.email === email);
    expect(created, 'usuario creado no aparece en /users').toBeDefined();

    const deactivate = await request.patch(`/api/v1/users/${created?.id}`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { active: false },
    });
    expect(deactivate.ok(), `desactivación falló: ${deactivate.status()}`).toBeTruthy();
  });
});
