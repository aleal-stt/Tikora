import { z } from 'zod';

const booleanString = z.enum(['true', 'false']).transform((v) => v === 'true');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI es obligatorio'),

  DEFAULT_TENANT_ID: z.string().min(1).default('tenant-default'),
  DEFAULT_TENANT_NAME: z.string().min(1).default('Empresa Demo'),
  DEFAULT_TENANT_TIMEZONE: z.string().min(1).default('America/Argentina/Buenos_Aires'),

  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_FULLNAME: z.string().min(1),
  SEED_ADMIN_PASSWORD: z.string().min(10),

  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  // Secretos JWT — generar con `openssl rand -hex 64`. El mínimo de 32 chars
  // descarta accidentes obvios (secretos por defecto, strings de prueba).
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET debe tener al menos 32 caracteres'),
  JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),

  COOKIE_SECURE: booleanString.default(false),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z
    .string()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : undefined)),

  LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
  LOGIN_LOCKOUT_MINUTES: z.coerce.number().int().positive().default(15),

  THROTTLE_AUTH_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().positive().default(10),
  THROTTLE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  THROTTLE_DEFAULT_LIMIT: z.coerce.number().int().positive().default(120),

  // Email — el adapter `live` queda como placeholder hasta que se integre
  // Resend en un sprint posterior. En dev quedamos con `log`.
  EMAIL_DELIVERY_MODE: z.enum(['log', 'live']).default('log'),
  EMAIL_FROM: z.string().min(1).default('Tikora <noreply@empresa.com>'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${issues}`);
  }
  return result.data;
}
