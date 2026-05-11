import { fetchSseTicket } from '../features/notifications/api/notifications-api';

/**
 * Tipos de frames que el back emite por el stream.
 * - `ready`: confirmación de handshake (data: { userId }).
 * - `heartbeat`: ping cada 30s (data: { ts }).
 * - Cualquier otro nombre es un `NotificationEventType` con el documento
 *   Notification serializado en `data`.
 */
export type SseFrame =
  | { type: 'ready'; data: { userId: string } }
  | { type: 'heartbeat'; data: { ts: number } }
  | { type: string; data: unknown; id?: string };

export interface SseClientHandlers {
  onFrame: (frame: SseFrame) => void;
  onStatus: (status: 'connecting' | 'connected' | 'reconnecting' | 'disconnected') => void;
}

const KNOWN_FRAME_TYPES = ['ready', 'heartbeat'] as const;

const NOTIFICATION_EVENT_TYPES = new Set([
  'TicketCreated',
  'TicketClassified',
  'TicketRequiresClassificationReview',
  'TicketAssigned',
  'TicketResolved',
  'TicketReopened',
  'TicketClosedDefinitively',
  'InteractionAdded',
  'AiResponseSuggested',
  'AiResponseApproved',
  'AiResponseSent',
  'AiResponseDiscarded',
  'AiResponseFailed',
  'SlaApproaching',
  'SlaBreach',
]);

/**
 * Cliente SSE de Tikora.
 *
 * Decisión §23: una conexión global, reconexión propia (no la nativa de
 * EventSource) porque el ticket es single-use y hay que pedir uno nuevo
 * en cada apertura. Backoff exponencial 1s → 2s → 4s → 8s → 16s → 30s.
 *
 * Uso típico:
 *   const client = new SseClient(handlers);
 *   await client.connect();
 *   // ... más tarde
 *   client.disconnect();
 */
export class SseClient {
  private eventSource: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;

  constructor(private readonly handlers: SseClientHandlers) {}

  /** Abre la conexión. Si ya hay una abierta, no hace nada. */
  async connect(): Promise<void> {
    if (this.eventSource) return;
    this.intentionallyClosed = false;
    await this.openOnce();
  }

  /** Cierra la conexión y cancela cualquier reconexión pendiente. */
  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.reconnectAttempts = 0;
    this.handlers.onStatus('disconnected');
  }

  private async openOnce(): Promise<void> {
    this.handlers.onStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');
    let ticket: string;
    try {
      const res = await fetchSseTicket();
      ticket = res.ticket;
    } catch {
      this.scheduleReconnect();
      return;
    }

    const url = `/api/v1/notifications/stream?ticket=${encodeURIComponent(ticket)}`;
    const es = new EventSource(url);
    this.eventSource = es;

    // Frames especiales se registran por nombre.
    for (const frameType of KNOWN_FRAME_TYPES) {
      es.addEventListener(frameType, (event) => {
        this.dispatch(frameType, (event as MessageEvent).data);
      });
    }
    // Frames de notificación: uno por cada tipo conocido.
    for (const eventType of NOTIFICATION_EVENT_TYPES) {
      es.addEventListener(eventType, (event) => {
        const messageEvent = event as MessageEvent;
        this.dispatch(eventType, messageEvent.data, messageEvent.lastEventId);
      });
    }

    es.onopen = () => {
      this.reconnectAttempts = 0;
      this.handlers.onStatus('connected');
    };

    es.onerror = () => {
      // EventSource emite `error` también en cierres normales del server
      // (p.ej. cuando el ticket vencía). Cerramos y reintentamos.
      es.close();
      this.eventSource = null;
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };
  }

  private dispatch(type: string, raw: unknown, id?: string): void {
    let data: unknown;
    try {
      data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      // Frame con data no-JSON: ignorar silenciosamente.
      return;
    }
    this.handlers.onFrame({ type, data, ...(id ? { id } : {}) } as SseFrame);
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.handlers.onStatus('reconnecting');
    const delay = this.computeBackoff();
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.openOnce();
    }, delay);
  }

  private computeBackoff(): number {
    // 1s, 2s, 4s, 8s, 16s, 30s (cap), 30s, …
    const base = Math.min(30_000, 1000 * 2 ** this.reconnectAttempts);
    // Jitter ±20% para evitar reconexiones en thundering herd al volver
    // el backend después de un outage.
    const jitter = base * 0.2 * (Math.random() * 2 - 1);
    return Math.max(500, Math.round(base + jitter));
  }
}
