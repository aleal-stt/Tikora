import { describe, expect, it, vi } from 'vitest';
import { SmtpEmailDeliverer } from './smtp.deliverer';

const sendMail = vi.fn();

vi.mock('nodemailer', () => ({
  createTransport: vi.fn(() => ({
    sendMail: (...args: unknown[]) => sendMail(...args),
  })),
}));

interface ConfigDefaults {
  EMAIL_FROM: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_SECURE: boolean;
  SMTP_USER: string;
  SMTP_PASS: string;
}

function buildHarness(overrides: Partial<ConfigDefaults> = {}) {
  const merged: ConfigDefaults = {
    EMAIL_FROM: 'Tikora <noreply@empresa.com>',
    SMTP_HOST: 'smtp.gmail.com',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_USER: 'tikora.notif@gmail.com',
    SMTP_PASS: 'app-password-16chars',
    ...overrides,
  };
  const config = {
    get: vi.fn((key: keyof ConfigDefaults) => merged[key]),
  };
  const deliverer = new SmtpEmailDeliverer(config as never);
  return { deliverer, sendMail };
}

describe('SmtpEmailDeliverer', () => {
  it('envía con el `from` configurado y propaga el messageId que devuelve nodemailer', async () => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({ messageId: '<abc-123@empresa.com>' });
    const { deliverer } = buildHarness();

    const result = await deliverer.send({
      to: 'usuario@empresa.com',
      subject: 'Hola',
      text: 'mensaje',
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Tikora <noreply@empresa.com>',
        to: 'usuario@empresa.com',
        subject: 'Hola',
        text: 'mensaje',
      }),
    );
    expect(result.messageId).toBe('<abc-123@empresa.com>');
  });

  it('si nodemailer no devuelve messageId, el resultado queda en null', async () => {
    sendMail.mockReset();
    sendMail.mockResolvedValue({});
    const { deliverer } = buildHarness();
    const result = await deliverer.send({ to: 'x@x.com', subject: 's', text: 't' });
    expect(result.messageId).toBeNull();
  });

  it('propaga el error si nodemailer falla — el caller decide qué hacer', async () => {
    sendMail.mockReset();
    sendMail.mockRejectedValue(new Error('SMTP timeout'));
    const { deliverer } = buildHarness();
    await expect(deliverer.send({ to: 'x@x.com', subject: 's', text: 't' })).rejects.toThrow(
      'SMTP timeout',
    );
  });
});
