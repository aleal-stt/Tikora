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

  // Fase activa de la IA: 1 = clasificación automática + escalado humano,
  // 2 = clasificación + auto-respuesta sugerida, 3 = auto-respuesta autónoma.
  AI_PHASE: z.coerce.number().int().min(1).max(3).default(1),

  // Almacenamiento de adjuntos (provider `local`). En producción se
  // recomienda montar un volumen persistente; cuando se cambie a S3
  // se reemplaza el `IAttachmentStorage` adapter sin tocar el resto.
  UPLOADS_DIR: z.string().min(1).default('./uploads'),

  // Redis — usado por BullMQ para encolar trabajos de clasificación IA.
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().min(1).default('tikora'),

  // Anthropic — `ANTHROPIC_API_KEY` puede quedar vacía en dev: si no está,
  // la cola encola pero el processor cae al fallback humano para cada job.
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL_CLASSIFICATION: z.string().min(1).default('claude-haiku-4-5-20251001'),
  ANTHROPIC_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  ANTHROPIC_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  ANTHROPIC_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  ANTHROPIC_MAX_TOKENS_CLASSIFICATION: z.coerce.number().int().positive().default(1024),
  ANTHROPIC_TEMP_CLASSIFICATION: z.coerce.number().min(0).max(2).default(0),
  ANTHROPIC_PROMPT_CACHE_ENABLED: booleanString.default(true),

  // Versión activa del prompt de clasificación. Se persiste en cada
  // `Classification` para auditar cambios entre versiones.
  CLASSIFICATION_PROMPT_VERSION: z.string().min(1).default('v1'),

  // Por debajo de este umbral, la IA se considera "no segura" y el ticket
  // pasa a `requiere_revision_clasificacion` para que un humano decida.
  UMBRAL_CONFIANZA_CLASIFICACION: z.coerce.number().min(0).max(1).default(0.7),
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
