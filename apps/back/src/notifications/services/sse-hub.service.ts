import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Notification as NotificationResponse } from '@tikora/core';
import { Observable, Subject } from 'rxjs';

export interface SseMessage {
  /** Tipo del evento de dominio (`TicketAssigned`, etc.). */
  type: string;
  /** Payload visible al cliente (mismo shape que la Notification). */
  data: NotificationResponse;
  /** Id del evento — el cliente puede mandar `Last-Event-ID` al reconectar. */
  id: string;
}

/**
 * Registry in-memory de conexiones SSE activas.
 *
 * Cada usuario puede tener múltiples conexiones (varias pestañas).
 * `push(userId, msg)` notifica a todas. Cuando el cliente desconecta,
 * el subject del consumer completa y el set se limpia automáticamente.
 *
 * TODO: para multi-instance del back se necesita un pubsub (Redis SUBSCRIBE)
 * que reenvíe a todas las réplicas. Hoy single-instance es suficiente.
 */
@Injectable()
export class SseHub implements OnModuleDestroy {
  private readonly logger = new Logger(SseHub.name);
  private readonly connections = new Map<string, Set<Subject<SseMessage>>>();

  /**
   * Registra una conexión nueva. Devuelve un `Observable` que el caller
   * usa con `@Sse()` y un `unregister` que cierra el subject de su lado
   * (NestJS lo invoca cuando el cliente desconecta).
   */
  register(userId: string): { stream: Observable<SseMessage>; unregister: () => void } {
    const subject = new Subject<SseMessage>();
    const set = this.connections.get(userId) ?? new Set();
    set.add(subject);
    this.connections.set(userId, set);

    return {
      stream: subject.asObservable(),
      unregister: () => {
        subject.complete();
        const current = this.connections.get(userId);
        if (!current) return;
        current.delete(subject);
        if (current.size === 0) {
          this.connections.delete(userId);
        }
      },
    };
  }

  push(userId: string, msg: SseMessage): void {
    const set = this.connections.get(userId);
    if (!set || set.size === 0) return;
    for (const subject of set) {
      try {
        subject.next(msg);
      } catch (err) {
        this.logger.warn(
          `Error empujando SSE a userId=${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  /** Útil para health checks / debugging. */
  connectionCount(userId?: string): number {
    if (userId !== undefined) return this.connections.get(userId)?.size ?? 0;
    let total = 0;
    for (const set of this.connections.values()) total += set.size;
    return total;
  }

  onModuleDestroy(): void {
    for (const set of this.connections.values()) {
      for (const subject of set) subject.complete();
    }
    this.connections.clear();
  }
}
