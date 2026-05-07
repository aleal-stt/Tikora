import { Controller, HttpStatus, Query, Sse } from '@nestjs/common';
import { interval, map, merge, Observable, Subject, take } from 'rxjs';
import { ApiException } from '../../common/exceptions/api.exception';
import { Public } from '../../auth/decorators/public.decorator';
import { SseTicketsService } from '../../sse-tickets/services/sse-tickets.service';
import { StreamQueryDto } from '../dto/stream.query.dto';
import { SseHub, SseMessage } from '../services/sse-hub.service';

interface SseEnvelope {
  id?: string;
  type?: string;
  data: unknown;
}

const HEARTBEAT_MS = 30_000;

/**
 * Endpoint del stream SSE. Es `@Public()` para evitar el JwtAuthGuard
 * (que requiere `Authorization: Bearer`); la autenticación se hace por
 * `?ticket=` con `SseTicketsService.consume` (single-use, TTL 90s).
 */
@Controller('notifications')
export class SseStreamController {
  constructor(private readonly sseTickets: SseTicketsService, private readonly hub: SseHub) {}

  @Public()
  @Sse('stream')
  async stream(@Query() query: StreamQueryDto): Promise<Observable<SseEnvelope>> {
    const payload = await this.sseTickets.consume(query.ticket);
    if (!payload) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'SSE_TICKET_INVALID',
        'El ticket SSE es inválido o expiró.',
      );
    }

    const { stream, unregister } = this.hub.register(payload.userId);

    // Heartbeat cada 30s para que proxies/intermediarios no corten la
    // conexión por inactividad. Se emite como evento `heartbeat` que el
    // cliente puede ignorar.
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      map(() => ({ type: 'heartbeat', data: { ts: Date.now() } } as SseEnvelope)),
    );

    // Evento inicial `ready` para confirmar conexión exitosa al cliente.
    const ready = new Subject<SseEnvelope>();
    setTimeout(() => {
      ready.next({ type: 'ready', data: { userId: payload.userId } });
      ready.complete();
    }, 0);

    const events = stream.pipe(map((msg: SseMessage) => this.toEnvelope(msg)));

    // Cuando el cliente cierra (NestJS unsuscribe), liberamos el slot del hub.
    return new Observable<SseEnvelope>((subscriber) => {
      const subscription = merge(ready.pipe(take(1)), heartbeat, events).subscribe(subscriber);
      return () => {
        subscription.unsubscribe();
        unregister();
      };
    });
  }

  private toEnvelope(msg: SseMessage): SseEnvelope {
    return { id: msg.id, type: msg.type, data: msg.data };
  }
}
