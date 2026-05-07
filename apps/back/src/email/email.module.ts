import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { EMAIL_DELIVERER } from './deliverers/email-deliverer.interface';
import { LogEmailDeliverer } from './deliverers/log.deliverer';
import { EmailService } from './services/email.service';

const delivererProvider: Provider = {
  provide: EMAIL_DELIVERER,
  inject: [ConfigService, LogEmailDeliverer],
  useFactory: (config: ConfigService<Env, true>, logDeliverer: LogEmailDeliverer) => {
    const mode = config.get('EMAIL_DELIVERY_MODE', { infer: true });
    if (mode === 'log') {
      return logDeliverer;
    }
    // El adapter real (Resend) llega en un sprint posterior; por ahora
    // forzar `log` evita olvidos silenciosos en prod.
    throw new Error(
      `EMAIL_DELIVERY_MODE='${mode}' aún no está implementado. Usar 'log' hasta integrar Resend.`,
    );
  },
};

@Module({
  providers: [LogEmailDeliverer, delivererProvider, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
