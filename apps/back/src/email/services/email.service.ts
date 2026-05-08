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
    const text = `Hola ${params.fullName},\n\n${params.body}\n\nSi necesitás más ayuda, respondé este correo y un agente continuará el caso.\n\n— Equipo Tikora`;
    const result = await this.deliverer.send({ to: params.to, subject, text });
    return { messageId: result.messageId };
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
