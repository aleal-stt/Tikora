import { useAuthStore } from '../stores/auth.store';

/**
 * Cliente HTTP de Tikora.
 *
 * - Base URL relativa (`/api/v1/*`): el proxy de Vite la redirige al
 *   backend en dev y en prod sirven mismo origen (cookies same-origin).
 * - `credentials: 'include'` para que la cookie httpOnly de refresh viaje
 *   solo a los endpoints de `/api/v1/auth/*` que la setean.
 * - Interceptor 401 → intenta refresh → reintenta una vez. Si el refresh
 *   falla, limpia el store y deja que el caller propague el error.
 */

const BASE_URL = '/api/v1';

interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown[];
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown[];

  constructor(body: ApiErrorBody) {
    super(body.message);
    this.name = 'ApiError';
    this.status = body.statusCode;
    this.code = body.code;
    this.details = body.details ?? [];
  }
}

interface RequestInit2 extends RequestInit {
  /** Internal flag para no recursar el interceptor de refresh. */
  _isRetry?: boolean;
}

let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  // Coalescing: si hay varios 401 simultáneos, una sola llamada de refresh.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { accessToken: string };
      useAuthStore.getState().setAccessToken(body.accessToken);
      return body.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, init: RequestInit2 = {}): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init.headers);
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (init.body !== undefined && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers,
    credentials: 'include',
  });

  if (res.status === 401 && !init._isRetry) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return apiFetch<T>(path, { ...init, _isRetry: true });
    }
    useAuthStore.getState().reset();
  }

  if (!res.ok) {
    const body = (await safeJson(res)) as Partial<ApiErrorBody> | null;
    throw new ApiError({
      statusCode: body?.statusCode ?? res.status,
      code: body?.code ?? 'API_ERROR',
      message: body?.message ?? `Error ${res.status}`,
      details: body?.details ?? [],
    });
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}
