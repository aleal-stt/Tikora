import { Body, Controller, Get, HttpStatus, Logger, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../auth/decorators/public.decorator';
import { ApiException } from '../../common/exceptions/api.exception';
import { TenantsService } from '../../tenants/services/tenants.service';
import { PasswordService } from '../../users/services/password.service';
import { UsersService } from '../../users/services/users.service';
import { TikoraOAuthProvider } from '../services/tikora-oauth-provider.service';

/**
 * Pantalla de consent del flow OAuth. Se renderiza como HTML directo
 * (sin template engine) para no agregar otra dependencia al back:
 *
 *  - `GET /oauth/consent?session=<code>` → form login + botón Autorizar.
 *  - `POST /oauth/consent` → valida credenciales, marca el row como
 *    autorizado vía `TikoraOAuthProvider.authorizePending` y redirige
 *    al cliente con `code`+`state`.
 *
 * Está montado fuera del global prefix `/api/v1` para que la URL final
 * cuadre con el endpoint OAuth standard expuesto por `mcpAuthRouter`.
 */
@Public()
@Controller('oauth')
export class OauthConsentController {
  private readonly logger = new Logger(OauthConsentController.name);

  constructor(
    private readonly provider: TikoraOAuthProvider,
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
    private readonly passwords: PasswordService,
  ) {}

  @Get('consent')
  async show(
    @Query('session') sessionCode: string | undefined,
    @Query('error') errorMessage: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!sessionCode) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(this.errorPage('Falta el parámetro session.'));
      return;
    }
    const pending = await this.provider.getPending(sessionCode);
    if (!pending) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(
          this.errorPage(
            'La sesión de autorización es inválida o expiró. Volvé a iniciar el flow desde el cliente.',
          ),
        );
      return;
    }

    res
      .status(HttpStatus.OK)
      .type('html')
      .send(
        this.consentPage({
          sessionCode,
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          scopes: pending.scopes,
          errorMessage: errorMessage ?? null,
        }),
      );
  }

  @Post('consent')
  async submit(
    @Body() body: { session?: string; email?: string; password?: string; action?: string },
    @Res() res: Response,
  ): Promise<void> {
    const sessionCode = (body.session ?? '').trim();
    if (!sessionCode) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .type('html')
        .send(this.errorPage('Falta el parámetro session.'));
      return;
    }

    // Botón "Cancelar": redirigir al cliente con error=access_denied.
    if (body.action === 'cancel') {
      const pending = await this.provider.getPending(sessionCode);
      if (pending) {
        const url = new URL(pending.redirectUri);
        url.searchParams.set('error', 'access_denied');
        if (pending.state) url.searchParams.set('state', pending.state);
        res.redirect(302, url.toString());
        return;
      }
      res.status(HttpStatus.OK).type('html').send(this.errorPage('Autorización cancelada.'));
      return;
    }

    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    if (!email || !password) {
      res.redirect(
        302,
        `/oauth/consent?session=${encodeURIComponent(sessionCode)}&error=${encodeURIComponent(
          'Email y contraseña son obligatorios.',
        )}`,
      );
      return;
    }

    const tenantId = await this.tenants.getDefaultTenantId();
    const user = await this.users.findByEmail(tenantId, email);
    if (!user || !user.active) {
      this.logger.warn(`Consent fallido: usuario no encontrado o inactivo email=${email}`);
      res.redirect(
        302,
        `/oauth/consent?session=${encodeURIComponent(sessionCode)}&error=${encodeURIComponent(
          'Credenciales inválidas.',
        )}`,
      );
      return;
    }

    const ok = await this.passwords.compare(password, user.passwordHash);
    if (!ok) {
      this.logger.warn(`Consent fallido: password incorrecta email=${email}`);
      res.redirect(
        302,
        `/oauth/consent?session=${encodeURIComponent(sessionCode)}&error=${encodeURIComponent(
          'Credenciales inválidas.',
        )}`,
      );
      return;
    }

    try {
      const { redirectUri, state } = await this.provider.authorizePending(sessionCode, {
        userId: user._id,
        tenantId: user.tenantId,
      });
      const url = new URL(redirectUri);
      url.searchParams.set('code', sessionCode);
      if (state) url.searchParams.set('state', state);
      this.logger.log(
        `Consent OK email=${email} userId=${user._id.toString()} redirigiendo a ${redirectUri}`,
      );
      res.redirect(302, url.toString());
    } catch (err) {
      if (err instanceof ApiException) {
        res.status(err.getStatus()).type('html').send(this.errorPage(err.message));
        return;
      }
      res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .type('html')
        .send(this.errorPage('Error interno procesando la autorización.'));
    }
  }

  private consentPage(input: {
    sessionCode: string;
    clientId: string;
    redirectUri: string;
    scopes: string[];
    errorMessage: string | null;
  }): string {
    const safeRedirect = this.escapeHtml(input.redirectUri);
    const safeClient = this.escapeHtml(input.clientId);
    const errorBanner = input.errorMessage
      ? `<div class="error">${this.escapeHtml(input.errorMessage)}</div>`
      : '';
    const scopesList = input.scopes.length
      ? `<ul class="scopes">${input.scopes
          .map((s) => `<li>${this.escapeHtml(s)}</li>`)
          .join('')}</ul>`
      : '<p class="muted">Sin scopes específicos — acceso a las 4 tools MCP de Tikora.</p>';

    return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Autorizar acceso — Tikora</title>
  <style>
    *,*::before,*::after{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
         background:#f5f5f7;color:#1d1d1f;margin:0;
         min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;}
    .card{background:#fff;max-width:420px;width:100%;padding:2rem;
          border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);}
    h1{font-size:1.25rem;margin:0 0 .25rem;}
    p{margin:.5rem 0;color:#48484a;line-height:1.45;}
    .muted{color:#86868b;font-size:.85rem;}
    .scopes{margin:.5rem 0 1rem;padding-left:1.25rem;color:#48484a;font-size:.9rem;}
    label{display:block;font-size:.85rem;color:#48484a;margin-top:.85rem;margin-bottom:.25rem;}
    input{width:100%;padding:.6rem .75rem;border:1px solid #d2d2d7;
          border-radius:8px;font:inherit;color:#1d1d1f;background:#fff;}
    input:focus{outline:2px solid #0071e3;outline-offset:1px;border-color:#0071e3;}
    .actions{display:flex;gap:.5rem;margin-top:1.25rem;}
    button{flex:1;padding:.6rem 1rem;border:none;border-radius:8px;
           font:inherit;font-weight:500;cursor:pointer;}
    .primary{background:#0071e3;color:#fff;}
    .primary:hover{background:#0077ed;}
    .secondary{background:#e5e5ea;color:#1d1d1f;}
    .error{background:#ffe8e8;color:#b00020;padding:.6rem .75rem;
           border-radius:8px;margin-bottom:.85rem;font-size:.9rem;}
    .meta{font-size:.78rem;color:#86868b;margin-top:1.25rem;
          padding-top:.85rem;border-top:1px solid #e5e5ea;word-break:break-all;}
    .meta strong{color:#48484a;}
  </style>
</head>
<body>
  <main class="card">
    <h1>Autorizar acceso</h1>
    <p>Una aplicación externa solicita acceso a tu cuenta de Tikora para operar tus tickets en tu nombre vía MCP.</p>
    ${scopesList}
    ${errorBanner}
    <form method="post" action="/oauth/consent" autocomplete="off">
      <input type="hidden" name="session" value="${this.escapeHtml(input.sessionCode)}" />
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autocomplete="username" />
      <label for="password">Contraseña</label>
      <input type="password" id="password" name="password" required autocomplete="current-password" />
      <div class="actions">
        <button type="submit" name="action" value="cancel" class="secondary">Cancelar</button>
        <button type="submit" name="action" value="authorize" class="primary">Autorizar</button>
      </div>
    </form>
    <div class="meta">
      <div><strong>Cliente:</strong> ${safeClient}</div>
      <div><strong>Redirect:</strong> ${safeRedirect}</div>
    </div>
  </main>
</body>
</html>`;
  }

  private errorPage(message: string): string {
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><title>Error — Tikora OAuth</title>
<style>body{font-family:-apple-system,sans-serif;background:#f5f5f7;color:#1d1d1f;
display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:1rem;}
.card{background:#fff;max-width:420px;padding:2rem;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);}
h1{font-size:1.15rem;margin:0 0 .5rem;color:#b00020;}p{color:#48484a;line-height:1.5;}</style>
</head><body><main class="card"><h1>No se pudo continuar</h1><p>${this.escapeHtml(
      message,
    )}</p></main></body></html>`;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
