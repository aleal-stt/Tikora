import { expect, test } from '@playwright/test';
import { E2E_CREDENTIALS, getAccessToken } from '../fixtures';

// Suite serial: crear documento (v1) → editar (v2). Requiere admin —
// `lider` también podría crear con su scope, pero los specs admin son
// el caso troncal. Atlas Vector Search no es necesario para los flujos
// de write (el indexado vectorial corre async sobre `kb_chunks`); si
// el cluster no soporta búsqueda vectorial, la versión y el contenido
// igual se persisten.

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ context }) => {
  const response = await context.request.post('/api/v1/auth/login', {
    data: E2E_CREDENTIALS.admin,
  });
  if (!response.ok()) {
    throw new Error(`pre-login admin falló: ${response.status()}`);
  }
});

test.describe.serial('KB admin', () => {
  const STAMP = Date.now();
  const title = `Doc E2E ${STAMP}`;
  const v1Content = `# Versión 1\n\nContenido inicial del doc E2E ${STAMP}.`;
  const v2Content = `# Versión 2\n\nContenido modificado del doc E2E ${STAMP}.`;

  let docId = '';

  test('crea un documento global desde la UI', async ({ page, request }) => {
    await page.goto('/admin/kb');
    await page.getByRole('button', { name: 'Nuevo documento' }).click();

    await page.getByLabel('Título').fill(title);
    // Scope queda en `global` por default — no toco el radio.
    await page.getByLabel('Contenido (Markdown)').fill(v1Content);

    // Capturamos el response del POST para tener el `id` del doc sin
    // depender del listado (que filtra `active: true` y excluye docs
    // mientras se indexan).
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/v1/kb-documents') &&
        res.request().method() === 'POST' &&
        res.status() === 201,
    );
    await page.getByRole('button', { name: 'Crear documento' }).click();
    const postResponse = await responsePromise;
    const createdDoc = (await postResponse.json()) as {
      id: string;
      version: number;
      scope: string;
    };
    expect(createdDoc.version).toBe(1);
    expect(createdDoc.scope).toBe('global');
    docId = createdDoc.id;

    await expect(page.getByText(/documento creado/i).first()).toBeVisible();

    // Polling hasta que el indexador active el doc — entonces aparece
    // en el listado del back y en la tabla del front.
    const token = await getAccessToken(request, 'admin');
    let activado = false;
    for (let i = 0; i < 20; i += 1) {
      const detail = await request.get(`/api/v1/kb-documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (detail.ok()) {
        const t = (await detail.json()) as { active: boolean };
        if (t.active) {
          activado = true;
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    expect(activado, 'el documento no se activó tras 10s').toBeTruthy();

    // Y el listado UI lo muestra tras refetch.
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('editar crea una nueva versión (v2)', async ({ page, request }) => {
    expect(docId, 'docId no se propagó del test previo').toBeTruthy();

    await page.goto('/admin/kb');
    // Abrir el menú del row del documento. La tabla tiene un botón
    // "Acciones" por fila — lo agarramos por el row que contiene el title.
    const row = page.locator('tr', { hasText: title });
    await row.getByRole('button', { name: 'Acciones' }).click();
    // El item muestra "Editar (crear vN+1)" — N varía, regex laxa.
    await page.getByRole('menuitem', { name: /editar/i }).click();

    // El form de edición carga el contenido v1 con la query del detalle.
    // Esperamos a que el textarea tenga algo antes de sobreescribir.
    const contenido = page.getByLabel('Contenido (Markdown)');
    await expect(contenido).not.toBeEmpty();
    await contenido.fill(v2Content);

    const putPromise = page.waitForResponse(
      (res) =>
        res.url().includes(`/api/v1/kb-documents/${docId}`) && res.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: 'Guardar como nueva versión' }).click();
    const putResponse = await putPromise;
    expect(putResponse.ok(), `PUT falló: ${putResponse.status()}`).toBeTruthy();
    const putBody = (await putResponse.json()) as { version: number };
    expect(putBody.version, `PUT retornó v=${putBody.version}`).toBeGreaterThanOrEqual(2);

    await expect(page.getByText(/versión \d+ creada/i).first()).toBeVisible();

    // El PUT crea un *nuevo* documento con v2 y lo deja inactivo hasta
    // que el indexador hace el swap; el documento original (v1) sigue
    // siendo el `active` mientras tanto. La historia se ve en
    // `GET /kb-documents/:id/versions` que devuelve la cadena completa.
    const token = await getAccessToken(request, 'admin');
    const versionsRes = await request.get(`/api/v1/kb-documents/${docId}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(
      versionsRes.ok(),
      `versions falló: ${versionsRes.status()} ${await versionsRes.text()}`,
    ).toBeTruthy();
    const versionsBody = await versionsRes.json();
    // El endpoint puede retornar un array directo o un wrapper `{items}` —
    // normalizamos para no acoplarnos al detalle.
    const items: Array<{ version: number }> = Array.isArray(versionsBody)
      ? versionsBody
      : (versionsBody as { items: Array<{ version: number }> }).items;
    const versionNumbers = items.map((v) => v.version).sort();
    expect(versionNumbers).toContain(1);
    expect(versionNumbers).toContain(2);
  });
});
