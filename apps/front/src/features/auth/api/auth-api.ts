import type { LoginRequest, LoginResponse, UserPublic } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';

export async function login(input: LoginRequest): Promise<LoginResponse> {
  const result = await apiFetch<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  useAuthStore.getState().setSession({
    accessToken: result.accessToken,
    user: result.user,
  });
  return result;
}

export async function logout(): Promise<void> {
  try {
    await apiFetch<void>('/auth/logout', { method: 'POST' });
  } finally {
    useAuthStore.getState().reset();
  }
}

/**
 * Bootstrap de sesión al cargar la SPA: intenta refrescar; si funciona
 * pobla el store con un GET /users/me; si falla queda `unauthenticated`.
 */
export async function bootstrapSession(): Promise<void> {
  const store = useAuthStore.getState();
  store.setStatus('authenticating');

  try {
    const refresh = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!refresh.ok) {
      store.reset();
      return;
    }
    const refreshed = (await refresh.json()) as { accessToken: string };
    store.setAccessToken(refreshed.accessToken);

    const user = await apiFetch<UserPublic>('/users/me');
    store.setSession({ accessToken: refreshed.accessToken, user });
  } catch {
    store.reset();
  }
}
