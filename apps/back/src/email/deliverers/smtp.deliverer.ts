import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, Transporter } from 'nodemailer';
import type { Env } from '../../config/env.schema';
import { EmailMessage, IEmailDeliverer, SendResult } from './email-deliverer.interface';

/**
 * Adapter SMTP genérico vía nodemailer. Configurable por env y compatible
 * con cualquier proveedor que exponga SMTP submission (Gmail, Outlook,
 * Zoho, Brevo, servidor propio).
 *
 * Para Gmail con cuenta gratuita el flujo es:
 *   1. Activar 2FA en la cuenta.
 *   2. Generar un *app password* desde
 *      https://myaccount.google.com/apppasswords (16 caracteres).
 *   3. Setear `SMTP_USER=<email>`, `SMTP_PASS=<app-password>`,
 *      `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`.
 *
 * Cuota práctica de Gmail gratuito: ~500 destinatarios por día. Para
 * piloto interno alcanza; al pasar a producción conviene migrar a un
 * proveedor con dominio propio (Resend, Brevo, SendGrid).
 *
 * El `from` se toma de `EMAIL_FROM` y debe corresponder al `SMTP_USER`
 * — Gmail bloquea el envío si difieren (anti-spoofing).
 */
@Injectable()
export class SmtpEmailDeliverer implements IEmailDeliverer {
  private readonly logger = new Logger(SmtpEmailDeliverer.name);
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.from = this.config.get('EMAIL_FROM', { infer: true });
    this.transporter = createTransport({
      host: this.config.get('SMTP_HOST', { infer: true }),
      port: this.config.get('SMTP_PORT', { infer: true }),
      secure: this.config.get('SMTP_SECURE', { infer: true }),
      auth: {
        user: this.config.get('SMTP_USER', { infer: true }),
        pass: this.config.get('SMTP_PASS', { infer: true }),
      },
    });
  }

  async send(message: EmailMessage): Promise<SendResult> {
    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      // nodemailer devuelve `messageId` con angle brackets (`<...@host>`).
      // Lo dejamos tal cual — coincide con el formato del header SMTP y
      // permite buscar el mensaje en la bandeja del proveedor.
      return { messageId: info.messageId ?? null };
    } catch (err) {
      this.logger.error(
        `SMTP send falló para to=${message.to}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }
  }
}
