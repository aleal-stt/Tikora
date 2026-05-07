import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ApiException } from '../../common/exceptions/api.exception';
import type { Env } from '../../config/env.schema';

export interface GenerateMetadata {
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
 * Wrapper único sobre el SDK de Anthropic. Encapsula retries con backoff
 * exponencial, validación Zod con prompt correctivo y emisión de métricas
 * de tokens/latencia. Es la única capa que habla con la API.
 */
@Injectable()
export class AiClientService {
  private readonly logger = new Logger(AiClientService.name);
  private readonly client: Anthropic | null;

  constructor(private readonly config: ConfigService<Env, true>) {
    const apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
    if (!apiKey) {
      // Sin API key el servicio queda en modo "no disponible". El caller
      // debe estar preparado para `AiClientUnavailableError` y caer al
      // fallback humano (ver `tikora-ia.md` §5.6).
      this.client = null;
      this.logger.warn(
        'ANTHROPIC_API_KEY no configurada — AiClientService deshabilitado, los jobs caerán al fallback humano.',
      );
      return;
    }
    this.client = new Anthropic({
      apiKey,
      timeout: this.config.get('ANTHROPIC_TIMEOUT_MS', { infer: true }),
      // Manejamos retries en este service para aplicar backoff con jitter
      // y para combinarlos con la validación correctiva de Zod.
      maxRetries: 0,
    });
  }

  isEnabled(): boolean {
    return this.client !== null;
  }

  async generate(params: GenerateParams): Promise<GenerateResult> {
    if (!this.client) {
      throw new AiClientUnavailableError('Anthropic client no inicializado.');
    }

    const maxRetries = this.config.get('ANTHROPIC_MAX_RETRIES', { infer: true });
    const backoffMs = this.config.get('ANTHROPIC_RETRY_BACKOFF_MS', { infer: true });

    const start = Date.now();
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.messages.create({
          model: params.model,
          max_tokens: params.maxTokens ?? 1024,
          temperature: params.temperature ?? 0,
          system: params.cacheSystemPrompt
            ? [
                {
                  type: 'text',
                  text: params.systemPrompt,
                  cache_control: { type: 'ephemeral' },
                },
              ]
            : params.systemPrompt,
          messages: [{ role: 'user', content: params.userMessage }],
        });

        const text = response.content
          .map((block) => (block.type === 'text' ? block.text : ''))
          .join('');

        return {
          text,
          tokensInput: response.usage.input_tokens,
          tokensInputCached:
            (response.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0,
          tokensOutput: response.usage.output_tokens,
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

    this.logger.warn(
      `AiClient ${params.metadata.purpose} falló tras reintentos: ${this.errorMessage(lastError)}`,
    );
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
   * aunque el prompt pide JSON puro.
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
