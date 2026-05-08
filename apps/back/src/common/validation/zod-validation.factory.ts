import { HttpStatus } from '@nestjs/common';
import { z } from 'zod';
import { ApiException } from '../exceptions/api.exception';

/**
 * Factory para `ZodValidationPipe.createValidationException`. Convierte el
 * `ZodError` que produce nestjs-zod en una `ApiException` con el shape
 * estándar definido en `tikora-api.md` §1:
 *
 * ```json
 * {
 *   "statusCode": 400,
 *   "code": "VALIDATION_FAILED",
 *   "message": "Validación fallida.",
 *   "details": [{ "path": "...", "message": "..." }]
 * }
 * ```
 *
 * Antes (default de nestjs-zod) los errores volvían como
 * `{statusCode, message: "Validation failed", errors: [...]}` — divergente
 * del contrato general y rompía el manejo unificado de errores en el front.
 */
export function createZodValidationException(error: unknown): Error {
  const issues = error instanceof z.ZodError ? error.issues : [];
  const details = issues.map((issue) => ({
    path: issue.path.map(String).join('.'),
    code: issue.code,
    message: issue.message,
  }));
  // El primer issue suele ser el más relevante para el usuario; lo usamos
  // como `message` principal. Si no hay issues (caso raro), caemos a un
  // mensaje genérico.
  const message = issues[0]?.message ?? 'Validación fallida.';
  return new ApiException(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', message, details);
}
