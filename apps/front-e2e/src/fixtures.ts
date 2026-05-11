import type { APIRequestContext } from '@playwright/test';
import { resolve } from 'node:path';

// Roles disponibles en el seed E2E. `admin` viene del seed estándar
// (SEED_ADMIN_*); el resto se crea cuando SEED_E2E_USERS=true. Ver
// `apps/back/src/seed/seed.service.ts`.
export type E2eRole = 'admin' | 'lider' | 'agente' | 'empleado';

interface Credentials {
  email: string;
  password: string;
}

// Las passwords se leen del entorno cuando estén definidas (CI), con
// fallback a los defaults del `.env.example` para correr en local sin
// configuración extra. NO usar estos valores en prod.
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
const E2E_PASSWORD = process.env.SEED_E2E_PASSWORD ?? 'E2eTest!23';

export const E2E_CREDENTIALS: Record<E2eRole, Credentials> = {
  admin: { email: 'admin@empresa.com', password: ADMIN_PASSWORD },
  lider: { email: 'lider@empresa.com', password: E2E_PASSWORD },
  agente: { email: 'agente@empresa.com', password: E2E_PASSWORD },
  empleado: { email: 'empleado@empresa.com', password: E2E_PASSWORD },
};

// Directorio compartido para los storageStates. Cada rol tiene un archivo
// `<rol>.json` con cookies de refresh (httpOnly). Generado por el proyecto
// `setup` antes de cualquier suite — limpiar `.auth/` fuerza re-login.
export const STORAGE_STATE_DIR = resolve(__dirname, '../.auth');

export function storageStateFor(role: E2eRole): string {
  return resolve(STORAGE_STATE_DIR, `${role}.json`);
}

/**
 * Devuelve un access token fresco loguándose como `role` contra la API.
 * Necesario para todos los specs que pegan a endpoints normales: la
 * cookie httpOnly solo autentica `/auth/refresh`, mientras que el resto
 * del back exige `Authorization: Bearer <token>`. Hacer login (vs.
 * reusar la cookie del storageState) evita problemas de cookies
 * rotadas/revocadas entre tests del mismo describe.
 */
export async function getAccessToken(request: APIRequestContext, role: E2eRole): Promise<string> {
  const creds = E2E_CREDENTIALS[role];
  const response = await request.post('/api/v1/auth/login', { data: creds });
  if (!response.ok()) {
    throw new Error(`login para Bearer (${role}) falló con ${response.status()}`);
  }
  const body = (await response.json()) as { accessToken: string };
  return body.accessToken;
}
