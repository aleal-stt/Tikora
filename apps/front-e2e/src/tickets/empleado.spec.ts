import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, getAccessToken } from '../fixtures';

// Suite serial: cada paso depende del anterior (crear → adjuntar → ver
// en lista → cancelar). El ticketId se comparte por closure. Con
// `workers: 1` (global) y `describe.serial`, el orden está garantizado.
//
// No usamos `storageState` precargado de archivo: cada bootstrap rota
// la cookie de refresh, dejando la del archivo revocada para el spec
// siguiente. Mejor login fresh por test contra `context.request` — las
// cookies de respuesta quedan en el contexto compartido con la page.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context }) => {
  const response = await context.request.post('/api/v1/auth/login', {
    data: E2E_CREDENTIALS.empleado,
  });
  if (!response.ok()) {
    throw new Error(`pre-login empleado falló: ${response.status()}`);
  }
});

test.describe.serial('Tickets — flujo empleado', () => {
  // Asunto único por corrida para que el listado lo encuentre sin
  // colisionar con tickets de corridas previas en la misma DB.
  const stamp = Date.now();
  const asunto = `Spec E2E empleado ${stamp}`;
  const cuerpo =
    `Ticket generado por la suite E2E el ${new Date().toISOString()}. ` +
    `Texto de relleno para superar el mínimo de 10 caracteres del schema.`;

  let ticketId = '';

  test('crea un ticket desde la UI y navega al detalle', async ({ page }) => {
    await page.goto('/mis-tickets/nuevo');
    await page.getByLabel('Asunto').fill(asunto);
    await page.getByLabel('Cuerpo').fill(cuerpo);
    await page.getByRole('button', { name: 'Crear ticket' }).click();

    // Redirige a `/tickets/:id` con el ObjectId del ticket creado.
    await expect(page).toHaveURL(/\/tickets\/[a-f0-9]{24}$/);

    const parts = page.url().split('/');
    ticketId = parts[parts.length - 1] ?? '';
    expect(ticketId).toMatch(/^[a-f0-9]{24}$/);

    // El detalle expone el asunto en un h1.
    await expect(page.getByRole('heading', { name: asunto, level: 1 })).toBeVisible();
  });

  test('sube un adjunto al ticket vía API', async ({ request }) => {
    expect(ticketId, 'el spec previo no produjo ticketId').toBeTruthy();

    // Los endpoints normales esperan `Authorization: Bearer <access>`.
    // La cookie httpOnly solo autentica `/auth/refresh`.
    const accessToken = await getAccessToken(request, 'empleado');

    const filename = 'adjunto-e2e.txt';
    const content = Buffer.from(`Contenido del adjunto E2E ${stamp}`, 'utf-8');

    const response = await request.post(`/api/v1/tickets/${ticketId}/attachments`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      multipart: {
        file: { name: filename, mimeType: 'text/plain', buffer: content },
      },
    });
    expect(
      response.ok(),
      `upload falló: ${response.status()} ${await response.text()}`,
    ).toBeTruthy();

    const body = (await response.json()) as { id: string; originalName: string };
    expect(body.id).toBeTruthy();
    expect(body.originalName).toBe(filename);
  });

  test('el ticket aparece en /mis-tickets', async ({ page }) => {
    expect(ticketId).toBeTruthy();
    await page.goto('/mis-tickets');
    // El listado muestra el asunto como título de cada card.
    await expect(page.getByText(asunto)).toBeVisible();
  });

  test('cancelar desde el detalle cambia el estado a cancelado', async ({ page, request }) => {
    expect(ticketId).toBeTruthy();
    await page.goto(`/tickets/${ticketId}`);

    // Botón principal "Cancelar" abre el panel de motivo. Es el único
    // botón con ese texto mientras Resolver/Reabrir no se hayan clicado.
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();

    // El textarea del panel no tiene label asociada. Lo ubicamos
    // tomando el padre directo del <p> "Motivo de la cancelación" —
    // ese div contiene solo el textarea del cancel.
    const panel = page.getByText('Motivo de la cancelación').locator('..');
    await panel.locator('textarea').fill('Cierre desde suite E2E.');
    await page.getByRole('button', { name: /confirmar cancelaci/i }).click();

    await expect(page.getByText(/ticket cancelado/i).first()).toBeVisible();

    // Confirmación independiente del toast: pegamos al back y leemos el
    // estado actual del ticket.
    const accessToken = await getAccessToken(request, 'empleado');
    const detail = await request.get(`/api/v1/tickets/${ticketId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(detail.ok()).toBeTruthy();
    const ticket = (await detail.json()) as { estado: string };
    expect(ticket.estado).toBe('cancelado');
  });
});
