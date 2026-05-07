import type { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.schema';
import { PasswordService } from './password.service';

function fakeConfig(rounds: number): ConfigService<Env, true> {
  return { get: () => rounds } as unknown as ConfigService<Env, true>;
}

describe('PasswordService', () => {
  // Rounds bajos para mantener los tests rápidos. La validación
  // del schema env exige >= 4 en producción.
  const service = new PasswordService(fakeConfig(4));

  it('genera un hash distinto a la contraseña en claro', async () => {
    const hash = await service.hash('SuperSecreta1!');
    expect(hash).not.toBe('SuperSecreta1!');
    expect(hash.length).toBeGreaterThan(20);
  });

  it('valida correctamente una contraseña que coincide', async () => {
    const hash = await service.hash('SuperSecreta1!');
    await expect(service.compare('SuperSecreta1!', hash)).resolves.toBe(true);
  });

  it('rechaza una contraseña que no coincide', async () => {
    const hash = await service.hash('SuperSecreta1!');
    await expect(service.compare('otra', hash)).resolves.toBe(false);
  });
});
