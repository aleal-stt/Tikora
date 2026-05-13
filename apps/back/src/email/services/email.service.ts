import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { EMAIL_DELIVERER, IEmailDeliverer } from '../deliverers/email-deliverer.interface';

interface WelcomeEmailRecipient {
  email: string;
  fullName: string;
}

interface AutoResponseEmailParams {
  to: string;
  fullName: string;
  ticketShortCode: string;
  asunto: string;
  body: string;
  /**
   * URL absoluta del botón "Esto no resolvió mi problema" (front
   * `/reopen-confirm?token=...`). Si está presente, se embed en el HTML
   * y se incluye al final del texto plano. Null/undefined ⇒ se manda
   * el correo sin botón (path Fase 2 sin envío autónomo).
   */
  reopenLink?: string | null;
}

interface AgentReplyEmailParams {
  to: string;
  fullName: string;
  ticketShortCode: string;
  asunto: string;
  body: string;
  agentFullName: string;
}

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_DELIVERER) private readonly deliverer: IEmailDeliverer,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Envía la auto-respuesta al solicitante. Devuelve el `messageId` que
   * provee el deliverer (SMTP devuelve el header `Message-Id`; el log
   * deliverer queda `null`). Se persiste en `AiResponse.emailMessageId`
   * para correlacionar respuestas que el solicitante mande luego.
   */
  async sendAutoResponseEmail(
    params: AutoResponseEmailParams,
  ): Promise<{ messageId: string | null }> {
    const subject = `Re: [${params.ticketShortCode}] ${params.asunto}`;
    const greeting = `Hola ${params.fullName},`;
    const closing = 'Si necesitás más ayuda, respondé este correo y un agente continuará el caso.';
    const sign = '— Equipo Tikora';
    const reopenNote = params.reopenLink
      ? `\n\n¿Esto no resolvió tu problema? Reabrí el ticket acá: ${params.reopenLink}`
      : '';
    const text = `${greeting}\n\n${params.body}\n\n${closing}${reopenNote}\n\n${sign}`;
    const html = this.renderAutoResponseHtml({
      greeting,
      body: params.body,
      closing,
      sign,
      reopenLink: params.reopenLink ?? null,
    });
    const result = await this.deliverer.send({ to: params.to, subject, text, html });
    return { messageId: result.messageId };
  }

  /**
   * Render del HTML del correo de auto-respuesta. Estilo simple (inline
   * styles) que sobrevive a los renderers de Gmail/Outlook sin CSS
   * externo. Cuando hay `reopenLink`, se incluye un botón destacado al
   * final con copia "Esto no resolvió mi problema".
   */
  private renderAutoResponseHtml(args: {
    greeting: string;
    body: string;
    closing: string;
    sign: string;
    reopenLink: string | null;
  }): string {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const bodyHtml = escape(args.body).replace(/\n/g, '<br>');
    const button = args.reopenLink
      ? `
      <div style="margin: 24px 0; padding: 16px; border: 1px solid #fde68a; background: #fffbeb; border-radius: 6px;">
        <p style="margin: 0 0 12px 0; font-size: 14px; color: #92400e;">
          ¿Esto no resolvió tu problema? Reabrí el ticket en un click.
        </p>
        <a href="${escape(args.reopenLink)}"
           style="display: inline-block; padding: 10px 18px; background: #d97706; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px;">
          Reabrir ticket
        </a>
      </div>`
      : '';
    return `<!doctype html>
<html lang="es"><body style="font-family: -apple-system, system-ui, sans-serif; color: #111827; max-width: 640px; margin: 0 auto; padding: 24px;">
  <p>${escape(args.greeting)}</p>
  <p>${bodyHtml}</p>
  <p style="color: #4b5563;">${escape(args.closing)}</p>
  ${button}
  <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">${escape(args.sign)}</p>
</body></html>`;
  }

  /**
   * Envía una respuesta del agente al solicitante manteniendo el ticket
   * abierto (a diferencia de la auto-respuesta, que cierra). No incluye
   * botón de reapertura porque el ticket sigue en curso; el solicitante
   * puede responder por mail o desde la app.
   */
  async sendAgentReplyEmail(params: AgentReplyEmailParams): Promise<{ messageId: string | null }> {
    const subject = `Re: [${params.ticketShortCode}] ${params.asunto}`;
    const greeting = `Hola ${params.fullName},`;
    const closing =
      'Si necesitás agregar algo, respondé este correo o seguí la conversación en la plataforma.';
    const sign = `— ${params.agentFullName} · Equipo Tikora`;
    const text = `${greeting}\n\n${params.body}\n\n${closing}\n\n${sign}`;
    const html = this.renderAgentReplyHtml({
      greeting,
      body: params.body,
      closing,
      sign,
    });
    const result = await this.deliverer.send({ to: params.to, subject, text, html });
    return { messageId: result.messageId };
  }

  private renderAgentReplyHtml(args: {
    greeting: string;
    body: string;
    closing: string;
    sign: string;
  }): string {
    const escape = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const bodyHtml = escape(args.body).replace(/\n/g, '<br>');
    return `<!doctype html>
<html lang="es"><body style="font-family: -apple-system, system-ui, sans-serif; color: #111827; max-width: 640px; margin: 0 auto; padding: 24px;">
  <p>${escape(args.greeting)}</p>
  <p>${bodyHtml}</p>
  <p style="color: #4b5563;">${escape(args.closing)}</p>
  <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">${escape(args.sign)}</p>
</body></html>`;
  }

  async sendWelcomeEmail(
    recipient: WelcomeEmailRecipient,
    temporaryPassword: string,
  ): Promise<void> {
    const from = this.config.get('EMAIL_FROM', { infer: true });
    const subject = 'Bienvenido a Tikora';
    const text =
      `Hola ${recipient.fullName},\n\n` +
      `Te dimos de alta en Tikora. Tus credenciales iniciales son:\n` +
      `  Email: ${recipient.email}\n` +
      `  Contraseña temporal: ${temporaryPassword}\n\n` +
      `Por seguridad, vas a tener que cambiarla en tu primer ingreso.\n\n` +
      `— Equipo Tikora\n` +
      `(remitente: ${from})`;

    await this.deliverer.send({
      to: recipient.email,
      subject,
      text,
    });
  }
}
