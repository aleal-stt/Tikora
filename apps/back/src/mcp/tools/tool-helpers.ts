import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ApiException } from '../../common/exceptions/api.exception';

/**
 * Empaqueta un error como `CallToolResult` con `isError: true`. Si el error
 * es una `ApiException` del back, reusa su `message` (texto en español apto
 * para mostrar). Para errores desconocidos, se prefija con el `fallback` y
 * NO se incluye el stack — el cliente MCP es externo y el detalle queda en
 * los logs del proceso.
 */
export function toolError(fallback: string, err?: unknown): CallToolResult {
  let detail = '';
  if (err instanceof ApiException) {
    const body = err.getResponse() as { message?: string };
    detail = body.message ? `: ${body.message}` : '';
  } else if (err instanceof Error) {
    detail = `: ${err.message}`;
  }
  return {
    content: [{ type: 'text', text: `${fallback}${detail}` }],
    isError: true,
  };
}
