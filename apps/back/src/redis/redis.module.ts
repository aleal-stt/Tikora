import { Global, Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.schema';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

const redisProvider: Provider = {
  provide: REDIS_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    new Redis(config.get('REDIS_URL', { infer: true }), {
      // Prefijo global para que las claves de Tikora no choquen con
      // otros consumidores que compartan el cluster.
      keyPrefix: `${config.get('REDIS_KEY_PREFIX', { infer: true })}:`,
      // Sin reintentos en el constructor: si Redis no está, los services
      // que lo usen propagan el error para que el caller decida fallback.
      lazyConnect: false,
      maxRetriesPerRequest: 3,
    }),
};

/**
 * Cliente Redis compartido para uso fuera del scope de BullMQ
 * (sse-tickets, futuros caches). Marcado como `@Global` para que
 * cualquier módulo lo inyecte sin importar `RedisModule` explícito.
 */
@Global()
@Module({
  providers: [redisProvider],
  exports: [redisProvider],
})
export class RedisModule {}
