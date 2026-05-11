import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SseClient, type SseFrame } from './sse-client';

vi.mock('../features/notifications/api/notifications-api', () => ({
  fetchSseTicket: vi.fn(),
}));

// Importar el mock después de declararlo para tipar la función.
const { fetchSseTicket } = await import('../features/notifications/api/notifications-api');
const mockedFetch = vi.mocked(fetchSseTicket);

interface MockEventSourceInstance {
  url: string;
  close: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  fireEvent: (type: string, data: unknown, id?: string) => void;
  fireOpen: () => void;
  fireError: () => void;
  onopen: ((this: MockEventSourceInstance) => void) | null;
  onerror: ((this: MockEventSourceInstance) => void) | null;
}

const createdInstances: MockEventSourceInstance[] = [];

class MockEventSource {
  url: string;
  close = vi.fn();
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  addEventListener = vi.fn((type: string, listener: (event: MessageEvent) => void) => {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  });
  onopen: ((this: MockEventSource) => void) | null = null;
  onerror: ((this: MockEventSource) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    createdInstances.push(this as unknown as MockEventSourceInstance);
  }

  fireEvent(type: string, data: unknown, id?: string): void {
    const listeners = this.listeners.get(type) ?? [];
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: id ?? '',
    });
    listeners.forEach((l) => l(event));
  }

  fireOpen(): void {
    this.onopen?.call(this);
  }

  fireError(): void {
    this.onerror?.call(this);
  }
}

describe('SseClient', () => {
  beforeEach(() => {
    createdInstances.length = 0;
    mockedFetch.mockReset();
    vi.stubGlobal('EventSource', MockEventSource);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('connect pide un ticket y abre EventSource con el ticket en query', async () => {
    mockedFetch.mockResolvedValue({ ticket: 'tkt-123', expiresAt: '...' });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);

    await client.connect();

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(createdInstances).toHaveLength(1);
    expect(createdInstances[0]?.url).toBe('/api/v1/notifications/stream?ticket=tkt-123');
    expect(handlers.onStatus).toHaveBeenCalledWith('connecting');
  });

  it('al abrir conexión, dispara onStatus connected', async () => {
    mockedFetch.mockResolvedValue({ ticket: 'a', expiresAt: '' });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);
    await client.connect();
    createdInstances[0]?.fireOpen();
    expect(handlers.onStatus).toHaveBeenCalledWith('connected');
  });

  it('un frame de notificación llega al handler con type, data y id', async () => {
    mockedFetch.mockResolvedValue({ ticket: 'a', expiresAt: '' });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);
    await client.connect();
    const es = createdInstances[0];
    if (!es) throw new Error('no event source');

    es.fireEvent('TicketCreated', { id: 'n_1', type: 'TicketCreated' }, 'n_1');

    expect(handlers.onFrame).toHaveBeenCalledWith({
      type: 'TicketCreated',
      data: { id: 'n_1', type: 'TicketCreated' },
      id: 'n_1',
    } satisfies SseFrame);
  });

  it('el frame ready se procesa', async () => {
    mockedFetch.mockResolvedValue({ ticket: 'a', expiresAt: '' });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);
    await client.connect();
    createdInstances[0]?.fireEvent('ready', { userId: 'u_1' });
    expect(handlers.onFrame).toHaveBeenCalledWith({
      type: 'ready',
      data: { userId: 'u_1' },
    });
  });

  it('disconnect cierra el EventSource y deja de reconectar', async () => {
    mockedFetch.mockResolvedValue({ ticket: 'a', expiresAt: '' });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);
    await client.connect();
    const es = createdInstances[0];
    if (!es) throw new Error('no event source');

    client.disconnect();

    expect(es.close).toHaveBeenCalled();
    expect(handlers.onStatus).toHaveBeenCalledWith('disconnected');

    // Un error después del disconnect no debería intentar reabrir.
    es.fireError();
    // Esperar un tick por si acaso.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('si fetchSseTicket falla, programa reconexión y marca status reconnecting', async () => {
    vi.useFakeTimers();
    mockedFetch.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({
      ticket: 'b',
      expiresAt: '',
    });
    const handlers = { onStatus: vi.fn(), onFrame: vi.fn() };
    const client = new SseClient(handlers);

    await client.connect();
    expect(handlers.onStatus).toHaveBeenCalledWith('reconnecting');

    // Avanzar lo suficiente para que el backoff dispare la reapertura.
    await vi.advanceTimersByTimeAsync(35_000);

    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(createdInstances).toHaveLength(1);

    client.disconnect();
  });
});
