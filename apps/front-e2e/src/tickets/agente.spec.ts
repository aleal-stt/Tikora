import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, getAccessToken } from '../fixtures';

// Estructura igual que `empleado.spec.ts`: arrancamos con storageState
// limpio y logueamos al agente vía API en cada test (las cookies van al
// context). El `beforeAll` arma las pre-condiciones con tokens de admin
// y empleado: área nueva, asignación del agente, ticket creado por el
// empleado y clasificado a esa área para que llegue a `escalado`.

test.use({ storageState: { cookies: [], origins: [] } });

const STAMP = Date.now();

interface Setup {
  areaId: string;
  agenteUserId: string;
  ticketId: string;
  shortCode: string;
  asunto: string;
}

let setup: Setup;

test.beforeAll(async ({ request }) => {
  const adminToken = await getAccessToken(request, 'admin');
  const adminAuth = { Authorization: `Bearer ${adminToken}` };

  // 1. Crear área (con SLA estándar para que el ticket se pueda clasificar).
  const areaRes = await request.post('/api/v1/areas', {
    headers: adminAuth,
    data: {
      name: `E2E área agente ${STAMP}`,
      description: 'Área generada por suite E2E para tests del flujo agente.',
      leaderIds: [],
      slas: { alta: 4, media: 24, baja: 48 },
    },
  });
  if (!areaRes.ok()) {
    throw new Error(`create area falló: ${areaRes.status()} ${await areaRes.text()}`);
  }
  const area = (await areaRes.json()) as { id: string };

  // 2. Obtener userId del agente — usamos el /users/me con un access del agente.
  const agenteToken = await getAccessToken(request, 'agente');
  const meRes = await request.get('/api/v1/users/me', {
    headers: { Authorization: `Bearer ${agenteToken}` },
  });
  if (!meRes.ok()) {
    throw new Error(`users/me agente falló: ${meRes.status()}`);
  }
  const agenteMe = (await meRes.json()) as { id: string };

  // 3. Asignar agente al área (idempotente — `$addToSet` en Mongo).
  const assignRes = await request.post(`/api/v1/areas/${area.id}/agents`, {
    headers: adminAuth,
    data: { userId: agenteMe.id },
  });
  if (!assignRes.ok()) {
    throw new Error(`assign agente falló: ${assignRes.status()} ${await assignRes.text()}`);
  }

  // 4. Empleado crea el ticket.
  const empleadoToken = await getAccessToken(request, 'empleado');
  const asunto = `Spec E2E agente ${STAMP}`;
  const ticketRes = await request.post('/api/v1/tickets', {
    headers: { Authorization: `Bearer ${empleadoToken}` },
    data: {
      asunto,
      cuerpo: `Ticket E2E generado el ${new Date().toISOString()} para el flujo agente.`,
    },
  });
  if (!ticketRes.ok()) {
    throw new Error(`create ticket falló: ${ticketRes.status()} ${await ticketRes.text()}`);
  }
  const ticket = (await ticketRes.json()) as { id: string; shortCode: string };

  // 5. Esperar a que el job async pase el ticket a `requiere_revision_clasificacion`.
  // El processor encola el job apenas se crea; con `LLM_API_KEY=''` el cliente IA
  // está deshabilitado, el job tira error y el procesador mueve el ticket. Eso
  // sucede en menos de un segundo, pero polling defensivo por si la cola está
  // pesada o Redis tarda en arrancar.
  let estadoActual = 'recibido';
  for (let i = 0; i < 20; i += 1) {
    const detail = await request.get(`/api/v1/tickets/${ticket.id}`, {
      headers: adminAuth,
    });
    if (detail.ok()) {
      const t = (await detail.json()) as { estado: string };
      estadoActual = t.estado;
      if (estadoActual === 'requiere_revision_clasificacion') {
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (estadoActual !== 'requiere_revision_clasificacion') {
    throw new Error(
      `el ticket no llegó a 'requiere_revision_clasificacion' tras 10s (estado=${estadoActual})`,
    );
  }

  // 6. Admin clasifica el ticket → estado `escalado` con SLA.
  const classifyRes = await request.patch(`/api/v1/tickets/${ticket.id}/classification`, {
    headers: adminAuth,
    data: { areaId: area.id, prioridad: 'media', motivo: 'Setup E2E agente' },
  });
  if (!classifyRes.ok()) {
    throw new Error(`classify ticket falló: ${classifyRes.status()} ${await classifyRes.text()}`);
  }

  setup = {
    areaId: area.id,
    agenteUserId: agenteMe.id,
    ticketId: ticket.id,
    shortCode: ticket.shortCode,
    asunto,
  };
});

test.beforeEach(async ({ context }) => {
  const response = await context.request.post('/api/v1/auth/login', {
    data: E2E_CREDENTIALS.agente,
  });
  if (!response.ok()) {
    throw new Error(`pre-login agente falló: ${response.status()}`);
  }
});

test.describe.serial('Tickets — flujo agente', () => {
  test('el ticket escalado aparece en la bandeja del agente', async ({ page }) => {
    await page.goto('/bandeja');
    await expect(page.getByText(setup.shortCode)).toBeVisible();
    await expect(page.getByText(setup.asunto)).toBeVisible();
  });

  test('toma el ticket y queda asignado al agente', async ({ page, request }) => {
    await page.goto(`/tickets/${setup.ticketId}`);
    await page.getByRole('button', { name: 'Tomar ticket' }).click();
    await expect(page.getByText(/ticket tomado/i).first()).toBeVisible();

    const token = await getAccessToken(request, 'agente');
    const detail = await request.get(`/api/v1/tickets/${setup.ticketId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(detail.ok()).toBeTruthy();
    const t = (await detail.json()) as { estado: string; assignedAgentId: string };
    expect(t.estado).toBe('en_progreso');
    expect(t.assignedAgentId).toBe(setup.agenteUserId);
  });

  test('agrega una nota desde el detalle', async ({ page }) => {
    await page.goto(`/tickets/${setup.ticketId}`);

    const nota = `Nota agente E2E ${STAMP}`;
    await page.getByPlaceholder('Agregá una nota o respuesta…').fill(nota);
    await page.getByRole('button', { name: 'Agregar nota' }).click();

    await expect(page.getByText(/nota agregada/i).first()).toBeVisible();
    // La nota aparece como interacción del ticket.
    await expect(page.getByText(nota)).toBeVisible();
  });

  test('resuelve el ticket', async ({ page, request }) => {
    await page.goto(`/tickets/${setup.ticketId}`);

    await page.getByRole('button', { name: 'Resolver' }).click();

    // El textarea de resolución usa este placeholder — único en el detalle.
    await page
      .getByPlaceholder('Detalle de la resolución (visible al solicitante)')
      .fill(`Resuelto desde suite E2E ${STAMP}`);
    await page.getByRole('button', { name: /confirmar resoluci/i }).click();

    await expect(page.getByText(/ticket resuelto/i).first()).toBeVisible();

    const token = await getAccessToken(request, 'agente');
    const detail = await request.get(`/api/v1/tickets/${setup.ticketId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // El back transiciona resolve → `cerrado` directamente (no existe un
    // estado intermedio `resuelto`). El flag `enviarPorCorreo` se persiste
    // como metadata de la interacción de sistema, no afecta el estado.
    const t = (await detail.json()) as { estado: string };
    expect(t.estado).toBe('cerrado');
  });
});
