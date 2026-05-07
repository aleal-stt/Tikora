import { HttpException, HttpStatus } from '@nestjs/common';

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details: unknown[];
}

/**
 * Excepción base que respeta el formato de error definido en
 * `tikora-api.md` §1: `{ statusCode, code, message, details[] }`.
 *
 * El `code` viaja en SCREAMING_SNAKE_CASE y es estable para el cliente;
 * el `message` es texto en español apto para mostrar al usuario final.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, details: unknown[] = []) {
    const body: ApiErrorBody = { statusCode: status, code, message, details };
    super(body, status);
  }
}
