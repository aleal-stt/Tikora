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

  // Email — `log` imprime a stdout (dev). `live` usa el adapter SMTP
  // (`SmtpEmailDeliverer`) con las variables `SMTP_*` de abajo. Para
  // free tier recomendamos Gmail con app password (~500 emails/día).
  EMAIL_DELIVERY_MODE: z.enum(['log', 'live']).default('log'),
  EMAIL_FROM: z.string().min(1).default('Tikora <noreply@empresa.com>'),

  // URL base del frontend — la usamos para construir links del correo
  // (botón "Esto no resolvió mi problema" → `/reopen-confirm?token=…`).
  FRONT_BASE_URL: z.string().url().default('http://localhost:5173'),

  // Secret y TTL del token de reapertura desde correo. Token JWT
  // firmado, embed en el botón del email auto-respuesta. Ver
  // `tikora-ia.md` §7.7. Mismo nivel de seguridad que JWT_SECRET.
  JWT_REOPEN_SECRET: z.string().min(32, 'JWT_REOPEN_SECRET debe tener al menos 32 caracteres'),
  // El default coincide con `slaReopenGraceDays` (5) — pasado ese
  // plazo el cron de SLA cierra el ticket definitivamente y el token
  // no tendría sentido aceptarlo.
  EMAIL_REOPEN_TOKEN_EXPIRES_IN: z.string().min(1).default('5d'),

  // SMTP — solo se usa cuando EMAIL_DELIVERY_MODE=live. En dev quedan
  // vacías y el deliverer SMTP no se instancia. Defaults apuntan al
  // submission de Gmail (TLS por STARTTLS en 587).
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // `false` ⇒ STARTTLS sobre 587. `true` ⇒ TLS directo (típico 465).
  SMTP_SECURE: booleanString.default(false),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),

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

  // LLM — proveedor agnóstico vía SDK OpenAI-compatible. Default apunta
  // al endpoint OpenAI-compat de Gemini (gratis con rate limit razonable
  // para MVP). Si `LLM_API_KEY` queda vacía en dev, el cliente de IA
  // queda deshabilitado y los jobs caen al fallback humano. Ver
  // `tikora-ia.md` §4. La abstracción se mantiene en `AiClientService`,
  // así que cambiar de proveedor es solo flip de envs.
  LLM_API_KEY: z.string().default(''),
  LLM_BASE_URL: z
    .string()
    .url()
    .default('https://generativelanguage.googleapis.com/v1beta/openai/'),
  // Clasificación: tarea de selección + JSON corto. `flash-lite` es el
  // más rápido y barato del free tier; latencia <500 ms en general.
  LLM_MODEL_CLASSIFICATION: z.string().min(1).default('gemini-2.0-flash-lite'),
  // Auto-respuesta: `flash` rinde bien escribiendo en español y siguiendo
  // schemas estructurados; usar `flash-lite` aquí también funciona pero
  // pierde un poco en redacción larga.
  LLM_MODEL_RESPONSE: z.string().min(1).default('gemini-2.0-flash'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
  LLM_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(1000),
  LLM_MAX_TOKENS_CLASSIFICATION: z.coerce.number().int().positive().default(1024),
  // Auto-respuesta usa más tokens de salida que clasificación porque la
  // respuesta al usuario puede tener varios párrafos.
  LLM_MAX_TOKENS_RESPONSE: z.coerce.number().int().positive().default(2048),
  LLM_TEMP_CLASSIFICATION: z.coerce.number().min(0).max(2).default(0),
  // Auto-respuesta usa temperatura > 0 para texto natural pero baja
  // (0.3) para mantener la respuesta pegada a la información de la KB.
  LLM_TEMP_RESPONSE: z.coerce.number().min(0).max(2).default(0.3),
  // Prompt caching está documentado como feature de Anthropic. Los modelos
  // free de OpenRouter no lo soportan, pero dejamos el flag para cuando
  // un proveedor compatible se integre.
  LLM_PROMPT_CACHE_ENABLED: booleanString.default(false),

  // Versión activa del prompt de clasificación. Se persiste en cada
  // `Classification` para auditar cambios entre versiones.
  CLASSIFICATION_PROMPT_VERSION: z.string().min(1).default('v1'),
  // Versión activa del prompt de auto-respuesta. Se persiste en cada
  // `AiResponse` para poder evaluar A/B entre versiones.
  RESPONSE_PROMPT_VERSION: z.string().min(1).default('v1'),

  // Por debajo de este umbral, la IA se considera "no segura" y el ticket
  // pasa a `requiere_revision_clasificacion` para que un humano decida.
  UMBRAL_CONFIANZA_CLASIFICACION: z.coerce.number().min(0).max(1).default(0.7),
  // Score mínimo de relevancia (cosine similarity) que debe tener al
  // menos un chunk de la KB para considerarla "respondible". Ver
  // tikora-embeddings.md §9.4.
  UMBRAL_RELEVANCIA_KB: z.coerce.number().min(0).max(1).default(0.75),
  // Confianza mínima de la respuesta IA a partir de la cual el envío
  // pasa a ser autónomo (Fase 3). Por debajo, requiere aprobación humana.
  UMBRAL_AUTO_AUTONOMA: z.coerce.number().min(0).max(1).default(0.9),
  // Porcentaje de respuestas autónomas que de todas formas pasan por un
  // agente humano para muestreo de calidad. 0.1 = 10% (Fase 3).
  AUTO_AUTONOMA_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0.1),

  // Truncado del cuerpo del ticket antes de mandarlo al modelo. Tickets
  // más largos se cortan con nota; evita prompts gigantes que rompen
  // el budget de tokens y/o disparan errores 400 del proveedor.
  MAX_TICKET_BODY_TOKENS: z.coerce.number().int().positive().default(4000),

  // SLA — cron periódico que detecta tickets próximos a vencer, vencidos
  // y aplica el cierre definitivo tras `slaAutoCloseDays` (config del
  // tenant) sin actividad. Default 5 min — el cron es relativamente
  // barato (queries indexadas + writes solo sobre tickets que cambian).
  // Bajar a 1 min para tests; subir si la flota de tickets crece mucho.
  SLA_CRON_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
  // Umbral de "próximo a vencer" como fracción del SLA total.
  // 0.25 = se notifica cuando queda ≤ 25 % del tiempo. Una sola vez por
  // ticket; el ticket queda flag-eado tras la primera notificación.
  SLA_APPROACHING_THRESHOLD_PERCENT: z.coerce.number().min(0).max(1).default(0.25),
  // Tope de tickets procesados por corrida del cron. Evita que un tenant
  // con backlog masivo monopolice un tick. Lo que no entró se procesa en
  // la próxima corrida.
  SLA_BATCH_SIZE: z.coerce.number().int().positive().default(200),

  // KB y embeddings — el módulo `kb` chunkea documentos, genera embeddings
  // localmente con Transformers.js y persiste en `kb_chunks` para búsqueda
  // vectorial vía Atlas Vector Search. Ver `tikora-embeddings.md` §3 y §8.
  EMBEDDING_MODEL_NAME: z.string().min(1).default('Xenova/multilingual-e5-small'),
  // Dimensiones del vector que produce el modelo. Cambiar de modelo con
  // dimensiones distintas requiere recrear el índice vectorial de Atlas.
  EMBEDDING_DIMENSIONS: z.coerce.number().int().positive().default(384),
  // Tamaño del batch al embeber chunks de un documento. 8 es seguro para
  // CPU; subir a 16 acelera ~2× a costa de RAM. Bajar a 1 desactiva batching.
  EMBEDDING_BATCH_SIZE: z.coerce.number().int().positive().max(64).default(8),
  // Cache local del modelo ONNX. En contenedores efímeros conviene montar
  // un volumen para no re-descargar los ~120 MB en cada deploy.
  TRANSFORMERS_CACHE: z.string().min(1).default('./.cache/transformers'),
  // Nombre del índice de Atlas Vector Search sobre `kb_chunks`. Se crea
  // manualmente desde Atlas UI siguiendo `tikora-setup.md`.
  MONGODB_VECTOR_INDEX_NAME: z.string().min(1).default('kb_chunks_vector'),
  // Retención de chunks marcados `active:false` antes de que el cron de
  // mantenimiento los borre físicamente del índice vectorial. Conservar al
  // menos 7 días para auditoría de respuestas IA.
  KB_INACTIVE_CHUNKS_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
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
