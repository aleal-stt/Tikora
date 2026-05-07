import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import type { LoginResponse, RefreshResponse } from '@tikora/core';
import type { CookieOptions, Request, Response } from 'express';
import { Env } from '../../config/env.schema';
import { ApiException } from '../../common/exceptions/api.exception';
import { SseTicketsService } from '../../sse-tickets/services/sse-tickets.service';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../auth.constants';
import { CurrentUser } from '../decorators/current-user.decorator';
import { Public } from '../decorators/public.decorator';
import { LoginDto } from '../dto/login.dto';
import { AuthService } from '../services/auth.service';
import type { AuthenticatedUser } from '../types/auth.types';

// Rate limit más estricto que el global para `/auth/login` y `/auth/refresh`.
// Espeja `THROTTLE_AUTH_*` en `.env.example`; al ajustar uno hay que ajustar
// el otro (los valores son literales porque los decoradores no inyectan config).
const AUTH_THROTTLE = { default: { ttl: 60_000, limit: 10 } } as const;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly sseTickets: SseTicketsService,
  ) {}

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.login({
      email: dto.email,
      password: dto.password,
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
    });
    this.setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return result.response;
  }

  @Public()
  @Throttle(AUTH_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshResponse> {
    const cookie = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof cookie !== 'string' || cookie.length === 0) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REFRESH_INVALID',
        'La sesión expiró o no es válida. Volvé a iniciar sesión.',
      );
    }
    const result = await this.auth.refresh(cookie, {
      userAgent: req.get('user-agent') ?? null,
      ip: req.ip ?? null,
    });
    this.setRefreshCookie(res, result.refresh.token, result.refresh.expiresAt);
    return { accessToken: result.accessToken };
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const cookie = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof cookie === 'string' && cookie.length > 0) {
      await this.auth.logout(cookie);
    }
    this.clearRefreshCookie(res);
  }

  /**
   * Emite un ticket corto (TTL 90s, single-use) para autenticar la
   * apertura del stream SSE. `EventSource` no permite enviar Bearer
   * en headers, así que el cliente pasa el ticket como `?ticket=`.
   */
  @HttpCode(HttpStatus.OK)
  @Post('sse-ticket')
  async issueSseTicket(
    @CurrentUser() caller: AuthenticatedUser,
  ): Promise<{ ticket: string; expiresAt: string }> {
    const issued = await this.sseTickets.issue({
      userId: caller.userId,
      tenantId: caller.tenantId,
    });
    return {
      ticket: issued.ticket,
      expiresAt: issued.expiresAt.toISOString(),
    };
  }

  private cookieBaseOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.config.get('COOKIE_SAMESITE', { infer: true }),
      domain: this.config.get('COOKIE_DOMAIN', { infer: true }),
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      ...this.cookieBaseOptions(),
      expires: expiresAt,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE_NAME, this.cookieBaseOptions());
  }
}
