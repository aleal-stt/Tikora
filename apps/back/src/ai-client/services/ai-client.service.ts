import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIError } from 'openai';
import { z } from 'zod';
import { ApiException } from '../../common/exceptions/api.exception';
import type { Env } from '../../config/env.schema';
import { AiCallLogService } from './ai-call-log.service';

export interface GenerateMetadata {
  /**
   * Tenant que dispara la llamada. Opcional para permitir invocaciones
   * sin contexto (tests integrados, scripts), pero los flujos productivos
   * deberían pasarlo siempre — si falta, el log de auditoría queda sin
   * filtro multi-tenant.
   */
  tenantId?: string;
  ticketId?: string;
  promptVersion: string;
  purpose: 'classification' | 'auto-response' | 'review';
}

export interface GenerateParams {
  model: string;
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Si el proveedor lo soporta, marca el system prompt para cacheo. Los
   * modelos free de OpenRouter no implementan caching — el flag queda
   * en la firma para que el día que se integre un proveedor compatible
   * (Anthropic, ciertos modelos premium) baste con activarlo por env
   * sin tocar consumidores.
   */
  cacheSystemPrompt?: boolean;
  metadata: GenerateMetadata;
}

export interface GenerateStructuredParams<T> extends GenerateParams {
  outputSchema: z.ZodType<T>;
  maxValidationRetries?: number;
}

export interface GenerateResult {
  text: string;
  tokensInput: number;
  /**
   * Tokens de input servidos desde caché del proveedor. Cero con
   * proveedores que no soportan caching (caso actual con OpenRouter).
   */
  tokensInputCached: number;
  tokensOutput: number;
  latencyMs: number;
  retries: number;
}

export interface GenerateStructuredResult<T> extends GenerateResult {
  parsed: T;
}

export class AiClientUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiClientUnavailableError';
  }
}

const TRANSIENT_STATUS = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Cliente único para LLMs vía API OpenAI-compatible. Default apunta al
 * endpoint OpenAI-compat de Gemini (`generativelanguage.googleapis.com/
 * v1beta/openai/`) para usar `gemini-2.0-flash` y `flash-lite` gratis en
 * MVP. Cualquier proveedor que exponga el mismo shape de chat completions
 * encaja cambiando `LLM_BASE_URL` y `LLM_API_KEY`.
 *
 * Encapsula:
 *
 * - Retries con backoff exponencial sobre errores transitorios.
 * - Validación de salida estructurada con Zod + reintento con prompt
 *   correctivo cuando el modelo devuelve algo fuera de schema.
 * - Métricas de tokens / latencia (sin contenido sensible).
 *
 * Es la única capa que habla con el proveedor; todos los demás módulos
 * (`classification`, `auto-response`, etc.) lo consumen vía DI.
 *
 * Match con `tikora-ia.md` §4 (la abstracción se mantiene; los nombres
 * de variables `LLM_*` son los que aplican post-migración a OpenRouter).
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly client: OpenAI | null;

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly callLog: AiCallLogService,
  ) {
    const apiKey = this.config.get('LLM_API_KEY', { infer: true });
    if (!apiKey) {
      // Sin API key el servicio queda en modo "no disponible". El caller
      // debe estar preparado para `AiClientUnavailableError` y caer al
      // fallback humano (ver `tikora-ia.md` §5.6).
      this.client = null;
      this.logger.warn(
        'LLM_API_KEY no configurada — AiClientService deshabilitado, los jobs caerán al fallback humano.',
      );
      return;
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: this.config.get('LLM_BASE_URL', { infer: true }),
      timeout: this.config.get('LLM_TIMEOUT_MS', { infer: true }),
      // Manejamos retries en este service para combinarlos con la
      // validación correctiva de Zod.
      maxRetries: 0,
    });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (!this.client) {
      throw new AiClientUnavailableError('LLM client no inicializado.');
    }

    const maxRetries = this.config.get('LLM_MAX_RETRIES', { infer: true });
    const backoffMs = this.config.get('LLM_RETRY_BACKOFF_MS', { infer: true });

    const start = Date.now();
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model: params.model,
          max_tokens: params.maxTokens ?? 1024,
          temperature: params.temperature ?? 0,
          messages: [
            { role: 'system', content: params.systemPrompt },
            { role: 'user', content: params.userMessage },
          ],
        });

        const text = response.choices[0]?.message?.content ?? '';
        const usage = response.usage;

        return {
          text,
          tokensInput: usage?.prompt_tokens ?? 0,
          // Algunos providers reportan cache hits en `prompt_tokens_details`
          // (estilo OpenAI); si no, queda en 0.
          tokensInputCached:
            (usage?.prompt_tokens_details as { cached_tokens?: number } | undefined)
              ?.cached_tokens ?? 0,
          tokensOutput: usage?.completion_tokens ?? 0,
          latencyMs: Date.now() - start,
          retries: attempt,
        };
      } catch (err) {
        lastError = err;
        if (!this.isTransient(err) || attempt === maxRetries) {
          break;
        }
        const delay = backoffMs * Math.pow(2, attempt);
        await this.sleep(delay);
      }
    }

    const errMessage = this.errorMessage(lastError);
    this.logger.warn(`AiClient ${params.metadata.purpose} falló tras reintentos: ${errMessage}`);
    // Auditoría — `generateStructured` no agrega otro log para api_error
    // porque éste ya cubre el caso (la llamada al LLM nunca dio output válido).
    await this.callLog.record({
      tenantId: params.metadata.tenantId ?? '',
      ticketId: params.metadata.ticketId ?? null,
      purpose: params.metadata.purpose,
      modelo: params.model,
      promptVersion: params.metadata.promptVersion,
      temperature: params.temperature ?? 0,
      maxTokens: params.maxTokens ?? 1024,
      tokensInput: 0,
      tokensInputCached: 0,
      tokensOutput: 0,
      latencyMs: Date.now() - start,
      retries: maxRetries,
      outcome: 'api_error',
      errorCode: 'AI_API_ERROR',
      errorMessage: errMessage,
    });
    throw new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_API_ERROR',
      'No se pudo contactar al modelo de IA.',
    );
  }

  async generateStructured<T>(
    params: GenerateStructuredParams<T>,
  ): Promise<GenerateStructuredResult<T>> {
    const maxValidationRetries = params.maxValidationRetries ?? 2;
    let userMessage = params.userMessage;
    let totalRetries = 0;
    let lastResult: GenerateResult | null = null;
    let lastIssues: string | null = null;

    for (let attempt = 0; attempt <= maxValidationRetries; attempt++) {
      const result = await this.generate({ ...params, userMessage });
      totalRetries += result.retries;

      const parsed = this.tryParse(result.text, params.outputSchema);
      if (parsed.ok) {
        // Log de auditoría del round-trip exitoso. Si hubo validation
        // retries previos, los logueamos por separado en el catch del
        // siguiente loop (acá ya salimos con éxito).
        await this.callLog.record({
          tenantId: params.metadata.tenantId ?? '',
          ticketId: params.metadata.ticketId ?? null,
          purpose: params.metadata.purpose,
          modelo: params.model,
          promptVersion: params.metadata.promptVersion,
          temperature: params.temperature ?? 0,
          maxTokens: params.maxTokens ?? 1024,
          tokensInput: result.tokensInput,
          tokensInputCached: result.tokensInputCached,
          tokensOutput: result.tokensOutput,
          latencyMs: result.latencyMs,
          retries: totalRetries,
          outcome: 'ok',
          errorCode: null,
          errorMessage: null,
        });
        return {
          ...result,
          retries: totalRetries,
          parsed: parsed.data,
        };
      }

      lastResult = result;
      lastIssues = parsed.issues;
      userMessage = `${params.userMessage}\n\nTu respuesta anterior no fue JSON válido o no respetó el schema. Devolvé EXACTAMENTE el JSON pedido, sin texto adicional. Errores: ${parsed.issues}`;
    }

    this.logger.warn(
      `AiClient generateStructured falló validación tras ${maxValidationRetries} reintentos: ${
        lastIssues ?? 'desconocido'
      }`,
    );
    // El último round-trip succedió a nivel transport pero el output no
    // pasó schema. Lo logueamos como validation_failure usando el último
    // resultado que tuvimos.
    await this.callLog.record({
      tenantId: params.metadata.tenantId ?? '',
      ticketId: params.metadata.ticketId ?? null,
      purpose: params.metadata.purpose,
      modelo: params.model,
      promptVersion: params.metadata.promptVersion,
      temperature: params.temperature ?? 0,
      maxTokens: params.maxTokens ?? 1024,
      tokensInput: lastResult?.tokensInput ?? 0,
      tokensInputCached: lastResult?.tokensInputCached ?? 0,
      tokensOutput: lastResult?.tokensOutput ?? 0,
      latencyMs: lastResult?.latencyMs ?? 0,
      retries: totalRetries,
      outcome: 'validation_failure',
      errorCode: 'AI_OUTPUT_INVALID',
      errorMessage: lastIssues,
    });
    throw new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AI_OUTPUT_INVALID',
      lastResult
        ? `La salida del modelo no respetó el schema esperado: ${lastIssues}`
        : 'La salida del modelo no respetó el schema esperado.',
    );
  }

  private tryParse<T>(
    text: string,
    schema: z.ZodType<T>,
  ): { ok: true; data: T } | { ok: false; issues: string } {
    let json: unknown;
    try {
      json = JSON.parse(this.extractJson(text));
    } catch {
      return { ok: false, issues: 'JSON inválido' };
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      return {
        ok: false,
        issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      };
    }
    return { ok: true, data: parsed.data };
  }

  /**
   * Extrae el primer bloque JSON del texto. Tolerante a respuestas que
   * vienen envueltas en markdown (` ```json ... ``` `) o con texto previo,
   * aunque el prompt pide JSON puro. Los modelos open-source son menos
   * disciplinados con eso, así que el extractor es la primera línea de
   * defensa antes del reintento correctivo.
   */
  private extractJson(text: string): string {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch && fenceMatch[1]) return fenceMatch[1].trim();
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return text.slice(firstBrace, lastBrace + 1);
    }
    return text.trim();
  }

  private isTransient(err: unknown): boolean {
    if (err instanceof APIError) {
      return typeof err.status === 'number' && TRANSIENT_STATUS.has(err.status);
    }
    if (err && typeof err === 'object' && 'status' in err) {
      const status = (err as { status?: number }).status;
      if (typeof status === 'number') return TRANSIENT_STATUS.has(status);
    }
    if (err instanceof Error) {
      return /timeout|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/i.test(err.message);
    }
    return false;
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
