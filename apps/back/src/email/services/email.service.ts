import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { EMAIL_DELIVERER, IEmailDeliverer } from '../deliverers/email-deliverer.interface';

interface WelcomeEmailRecipient {
  email: string;
  fullName: string;
}

@Injectable()
export class EmailService {
  constructor(
    @Inject(EMAIL_DELIVERER) private readonly deliverer: IEmailDeliverer,
    private readonly config: ConfigService<Env, true>,
  ) {}

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
