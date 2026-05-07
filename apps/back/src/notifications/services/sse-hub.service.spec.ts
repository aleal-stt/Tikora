import { describe, expect, it, vi } from 'vitest';
import { SseHub } from './sse-hub.service';

describe('SseHub', () => {
  it('push emite a todas las conexiones del userId', () => {
    const hub = new SseHub();
    const r1 = hub.register('u1');
    const r2 = hub.register('u1');
    const next1 = vi.fn();
    const next2 = vi.fn();
    r1.stream.subscribe(next1);
    r2.stream.subscribe(next2);

    hub.push('u1', { id: 'e1', type: 'TicketCreated', data: { foo: 'bar' } as never });
    expect(next1).toHaveBeenCalledTimes(1);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it('push a un userId sin conexiones es no-op', () => {
    const hub = new SseHub();
    expect(() =>
      hub.push('inexistente', { id: 'e1', type: 'TicketCreated', data: {} as never }),
    ).not.toThrow();
  });

  it('unregister remueve la conexión y permite recolectar el set vacío', () => {
    const hub = new SseHub();
    const r = hub.register('u1');
    expect(hub.connectionCount('u1')).toBe(1);
    r.unregister();
    expect(hub.connectionCount('u1')).toBe(0);
    expect(hub.connectionCount()).toBe(0);
  });

  it('múltiples conexiones del mismo userId se cuentan', () => {
    const hub = new SseHub();
    hub.register('u1');
    hub.register('u1');
    hub.register('u2');
    expect(hub.connectionCount('u1')).toBe(2);
    expect(hub.connectionCount('u2')).toBe(1);
    expect(hub.connectionCount()).toBe(3);
  });
});
