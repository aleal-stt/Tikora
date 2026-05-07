export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Contrato para entregar correos. La fachada `EmailService` no conoce
 * a Resend ni al logger; se inyecta un adapter que implementa esta
 * interface según `EMAIL_DELIVERY_MODE`.
 */
export interface IEmailDeliverer {
  send(message: EmailMessage): Promise<void>;
}

/** Token DI para inyectar el deliverer activo. */
export const EMAIL_DELIVERER = Symbol('EMAIL_DELIVERER');
