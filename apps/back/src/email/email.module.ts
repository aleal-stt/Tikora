import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { EMAIL_DELIVERER } from './deliverers/email-deliverer.interface';
import { LogEmailDeliverer } from './deliverers/log.deliverer';
import { SmtpEmailDeliverer } from './deliverers/smtp.deliverer';
import { EmailService } from './services/email.service';

const delivererProvider: Provider = {
  provide: EMAIL_DELIVERER,
  inject: [ConfigService, LogEmailDeliverer, SmtpEmailDeliverer],
  useFactory: (
    config: ConfigService<Env, true>,
    logDeliverer: LogEmailDeliverer,
    smtpDeliverer: SmtpEmailDeliverer,
  ) => {
    const mode = config.get('EMAIL_DELIVERY_MODE', { infer: true });
    if (mode === 'log') return logDeliverer;
    if (mode === 'live') {
      // Sanity check: si no hay credenciales, mejor fallar al boot que
      // descubrirlo en el primer envío. Dev sin SMTP ⇒ usar `log`.
      if (!config.get('SMTP_USER', { infer: true }) || !config.get('SMTP_PASS', { infer: true })) {
        throw new Error(
          'EMAIL_DELIVERY_MODE=live requiere SMTP_USER y SMTP_PASS. Configurar las envs o pasar a EMAIL_DELIVERY_MODE=log.',
        );
      }
      return smtpDeliverer;
    }
    throw new Error(`EMAIL_DELIVERY_MODE='${mode}' inválido.`);
  },
};

@Module({
  providers: [LogEmailDeliverer, SmtpEmailDeliverer, delivererProvider, EmailService],
  exports: [EmailService],
})
export class EmailModule {}
