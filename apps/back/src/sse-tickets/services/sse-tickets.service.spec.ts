import { describe, expect, it, vi } from 'vitest';
import { SseTicketsService } from './sse-tickets.service';

function buildHarness() {
  const store = new Map<string, string>();

  const redis = {
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    getdel: vi.fn(async (key: string) => {
      const value = store.get(key);
      if (value === undefined) return null;
      store.delete(key);
      return value;
    }),
  };

  const config = { get: vi.fn() };

  const service = new SseTicketsService(redis as never, config as never);
  return { service, redis, store };
}

describe('SseTicketsService', () => {
  it('issue genera un ticket UUID y lo persiste con payload', async () => {
    const { service, redis, store } = buildHarness();
    const result = await service.issue({ userId: 'u1', tenantId: 't1' });

    expect(result.ticket).toMatch(/[a-f0-9-]{36}/i);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(redis.set).toHaveBeenCalledWith(
      `sse-ticket:${result.ticket}`,
      JSON.stringify({ userId: 'u1', tenantId: 't1' }),
      'EX',
      90,
    );
    expect(store.size).toBe(1);
  });

  it('consume devuelve el payload y elimina el ticket (single-use)', async () => {
    const { service, store } = buildHarness();
    const issued = await service.issue({ userId: 'u1', tenantId: 't1' });

    const first = await service.consume(issued.ticket);
    expect(first).toEqual({ userId: 'u1', tenantId: 't1' });
    expect(store.size).toBe(0);

    // Segundo intento de consumo devuelve null.
    const second = await service.consume(issued.ticket);
    expect(second).toBeNull();
  });

  it('consume con ticket vacío o inexistente retorna null sin tocar Redis', async () => {
    const { service } = buildHarness();
    expect(await service.consume('')).toBeNull();
    expect(await service.consume('no-existe')).toBeNull();
  });
});
