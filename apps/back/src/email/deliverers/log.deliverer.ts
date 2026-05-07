import { Injectable, Logger } from '@nestjs/common';
import { EmailMessage, IEmailDeliverer } from './email-deliverer.interface';

/**
 * Adapter de desarrollo: imprime el correo en stdout en vez de enviarlo.
 * No es un mock: se usa en dev para que el flujo siga funcionando sin
 * dependencias externas. Cambiando `EMAIL_DELIVERY_MODE=live` se cambia
 * por el adapter real (Resend) sin tocar al caller.
 */
@Injectable()
export class LogEmailDeliverer implements IEmailDeliverer {
  private readonly logger = new Logger(LogEmailDeliverer.name);

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(
      `EMAIL [log mode] → to=${message.to} subject="${message.subject}"\n${message.text}`,
    );
  }
}
