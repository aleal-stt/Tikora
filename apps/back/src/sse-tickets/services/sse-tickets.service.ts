import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import type Redis from 'ioredis';
import type { Env } from '../../config/env.schema';
import { REDIS_CLIENT } from '../../redis/redis.module';

const TTL_SECONDS = 90;
const KEY_PREFIX = 'sse-ticket';

export interface IssuedSseTicket {
  ticket: string;
  expiresAt: Date;
}

export interface SseTicketPayload {
  userId: string;
  tenantId: string;
}

/**
 * Tickets cortos single-use para autenticar conexiones SSE.
 * `EventSource` no permite enviar headers custom (no se puede mandar
 * Bearer), así que el cliente pasa el ticket como query param.
 *
 * Implementación con Redis (TTL nativo + delete-on-read atómico vía
 * GETDEL). Match con `tikora-data-model.md` §3.4 — alternativa preferida.
 */
@Injectable()
export class SseTicketsService {
  private readonly logger = new Logger(SseTicketsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly _config: ConfigService<Env, true>,
  ) {
    void this._config; // mantenido para futura inyección de TTL/longitud configurable
  }

  async issue(payload: SseTicketPayload): Promise<IssuedSseTicket> {
    const ticket = randomUUID();
    const json = JSON.stringify(payload);
    await this.redis.set(this.key(ticket), json, 'EX', TTL_SECONDS);
    return {
      ticket,
      expiresAt: new Date(Date.now() + TTL_SECONDS * 1000),
    };
  }

  /**
   * Consume el ticket atómicamente: si existe, lo elimina y devuelve el
   * payload. Single-use por construcción — el cliente no puede reabrir
   * la conexión con el mismo ticket si fue desconectado.
   */
  async consume(ticket: string): Promise<SseTicketPayload | null> {
    if (!ticket || typeof ticket !== 'string') return null;
    const raw = await this.redis.getdel(this.key(ticket));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SseTicketPayload;
    } catch (err) {
      // El payload se serializó nosotros mismos, así que un parse fallido
      // es señal de corrupción del cluster Redis. Loggear y rechazar.
      this.logger.warn(
        `SSE ticket con payload inválido en Redis: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private key(ticket: string): string {
    return `${KEY_PREFIX}:${ticket}`;
  }
}
