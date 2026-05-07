import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/auth.store';
import { ApiError, apiFetch } from './api-client';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('apiFetch', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'fetch'>>;

  beforeEach(() => {
    useAuthStore.getState().reset();
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('manda Authorization si hay accessToken en el store', async () => {
    useAuthStore.getState().setSession({
      accessToken: 'access-jwt',
      user: {
        id: 'u',
        email: 'a@b.com',
        fullName: 'X',
        role: 'admin',
        areaIds: [],
      },
    });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await apiFetch('/health');

    const headers = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer access-jwt');
  });

  it('en 401 intenta refresh y reintenta una vez', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_REQUIRED' }))
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'new-token' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const result = await apiFetch<{ ok: boolean }>('/users/me');

    expect(result).toEqual({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(useAuthStore.getState().accessToken).toBe('new-token');
  });

  it('si el refresh falla, limpia el store y lanza ApiError', async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_REQUIRED' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH_REFRESH_INVALID' }));

    await expect(apiFetch('/users/me')).rejects.toBeInstanceOf(ApiError);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });

  it('lanza ApiError con code y message del cuerpo cuando el back los devuelve', async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(409, {
        statusCode: 409,
        code: 'TICKET_TRANSITION_INVALID',
        message: 'Transición inválida.',
      }),
    );

    try {
      await apiFetch('/tickets/1/take', { method: 'PATCH' });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(409);
      expect((err as ApiError).code).toBe('TICKET_TRANSITION_INVALID');
    }
  });

  it('204 retorna undefined sin parsear', async () => {
    fetchSpy.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await apiFetch('/auth/logout', { method: 'POST' });
    expect(result).toBeUndefined();
  });
});
