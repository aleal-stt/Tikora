import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../config/env.schema';

export interface ReopenTokenPayload {
  /** Sub: el ticketId al que aplica el botón. */
  ticketId: string;
  /** Solicitante autorizado a clickear (validamos contra `ticket.requesterId`). */
  requesterId: string;
  /** AiResponse origen — para marcar `reopenedAfterAutoResponse=true`. */
  aiResponseId: string;
  /** Multi-tenant safety. */
  tenantId: string;
  /** Mostrado en la página de confirmación sin requerir lookup adicional. */
  shortCode: string;
}

/**
 * Tokens del flujo "Reabrir desde correo" — `tikora-ia.md` §7.7.
 *
 * Vivienen embed en el botón del email de auto-respuesta. Cuando el
 * solicitante clickea, el front lee el token, decodifica el payload
 * sólo para mostrar info (sin verificar firma — eso lo hace el back) y,
 * al confirmar, lo manda al endpoint público `/tickets/:id/reopen-from-email`
 * que verifica firma y expiración.
 *
 * Secret y TTL son dedicados (no reusamos `JWT_SECRET`):
 * - `JWT_REOPEN_SECRET` aislado para limitar el blast radius si se filtra.
 * - `EMAIL_REOPEN_TOKEN_EXPIRES_IN` default `5d` = `slaReopenGraceDays`.
 *   Pasado ese plazo el cron de SLA cierra el ticket definitivamente y
 *   el token deja de tener sentido aceptarlo.
 *
 * No implementamos single-use (almacenar `jti` consumidos en Redis).
 * El reopen es idempotente a nivel state-machine (segunda invocación
 * sobre un ticket que ya quedó `en_progreso` devuelve 409), así que
 * el riesgo de doble uso es operativamente nulo.
 */
@Injectable()
export class EmailReopenTokenService {
  private readonly logger = new Logger(EmailReopenTokenService.name);
  private readonly secret: string;
  private readonly expiresIn: string;

  constructor(private readonly jwt: JwtService, config: ConfigService<Env, true>) {
    this.secret = config.get('JWT_REOPEN_SECRET', { infer: true });
    this.expiresIn = config.get('EMAIL_REOPEN_TOKEN_EXPIRES_IN', { infer: true });
  }

  sign(payload: ReopenTokenPayload): string {
    return this.jwt.sign(payload, {
      secret: this.secret,
      expiresIn: this.expiresIn,
    });
  }

  /**
   * Devuelve el payload si el token es válido (firma OK + no expirado).
   * Lanza si no — el caller mapea a 401/403 según contexto.
   */
  verify(token: string): ReopenTokenPayload {
    const decoded = this.jwt.verify<ReopenTokenPayload & { iat: number; exp: number }>(token, {
      secret: this.secret,
    });
    return {
      ticketId: decoded.ticketId,
      requesterId: decoded.requesterId,
      aiResponseId: decoded.aiResponseId,
      tenantId: decoded.tenantId,
      shortCode: decoded.shortCode,
    };
  }
}
