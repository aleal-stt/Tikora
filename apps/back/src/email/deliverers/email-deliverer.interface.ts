export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Resultado de un envío. `messageId` es el identificador estable que
 * devuelve el proveedor (header `Message-Id` en SMTP) — lo persistimos
 * en `AiResponse.emailMessageId` para correlacionar respuestas en la
 * bandeja del solicitante. Es `null` cuando el deliverer no lo expone
 * (modo `log`).
 */
export interface SendResult {
  messageId: string | null;
}

/**
 * Contrato para entregar correos. La fachada `EmailService` no conoce
 * al adapter concreto; se inyecta uno que implementa esta interface
 * según `EMAIL_DELIVERY_MODE`.
 */
export interface IEmailDeliverer {
  send(message: EmailMessage): Promise<SendResult>;
}

/** Token DI para inyectar el deliverer activo. */
export const EMAIL_DELIVERER = Symbol('EMAIL_DELIVERER');
