import { JwtService } from '@nestjs/jwt';
import { describe, expect, it, vi } from 'vitest';
import { EmailReopenTokenService } from './email-reopen-token.service';

const SECRET = 'a'.repeat(64);

function buildHarness(expiresIn = '5d') {
  const config = {
    get: vi.fn((key: string) => {
      if (key === 'JWT_REOPEN_SECRET') return SECRET;
      if (key === 'EMAIL_REOPEN_TOKEN_EXPIRES_IN') return expiresIn;
      return undefined;
    }),
  };
  const jwt = new JwtService({});
  const service = new EmailReopenTokenService(jwt, config as never);
  return { service, jwt };
}

const PAYLOAD = {
  ticketId: 't_1',
  requesterId: 'u_1',
  aiResponseId: 'r_1',
  tenantId: 'tn_1',
  shortCode: 'TIK-7',
};

describe('EmailReopenTokenService', () => {
  it('round-trip sign/verify devuelve el mismo payload', () => {
    const { service } = buildHarness();
    const token = service.sign(PAYLOAD);
    expect(token.split('.')).toHaveLength(3);
    const decoded = service.verify(token);
    expect(decoded).toEqual(PAYLOAD);
  });

  it('rechaza token con firma de otro secret', () => {
    const { service } = buildHarness();
    // Tokeneamos con un secret distinto manualmente.
    const otherJwt = new JwtService({});
    const tampered = otherJwt.sign(PAYLOAD, { secret: 'b'.repeat(64), expiresIn: '5d' });
    expect(() => service.verify(tampered)).toThrow();
  });

  it('rechaza token expirado', () => {
    const { service, jwt } = buildHarness();
    // Firmamos directamente con expiresIn negativo para simular expirado.
    const expired = jwt.sign(PAYLOAD, { secret: SECRET, expiresIn: '-1s' });
    expect(() => service.verify(expired)).toThrow();
  });

  it('rechaza token mal formado', () => {
    const { service } = buildHarness();
    expect(() => service.verify('not-a-jwt')).toThrow();
  });
});
