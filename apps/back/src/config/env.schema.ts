import { z } from 'zod';

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
