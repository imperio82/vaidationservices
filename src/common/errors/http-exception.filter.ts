import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, ErrorCode, ErrorDetail } from './app-error';
import { ERROR_MESSAGES } from './error-messages';

interface ErrorBody {
  error: { code: string; message: string; details?: ErrorDetail[] };
}

interface ErrorResponse {
  status: number;
  body: ErrorBody;
  headers?: Record<string, string>;
}

/**
 * JSON mal formado. Express lanza un SyntaxError con `type: 'entity.parse.failed'` y Nest lo
 * convierte en un BadRequestException sin causa. El código propio nunca lanza
 * BadRequestException (usa AppError), así que un 400 de Nest en una petición con cuerpo JSON
 * solo puede venir del body parser.
 */
function isJsonParseError(exception: unknown, request: Request): boolean {
  if ((exception as { type?: unknown } | null)?.type === 'entity.parse.failed') return true;
  return (
    exception instanceof BadRequestException &&
    /json/i.test(request.headers['content-type'] ?? '')
  );
}

/** Filtro global: toda respuesta de error sale con el formato `{ error: { code, message, details? } }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const { status, body, headers } = this.toResponse(exception, http.getRequest<Request>());
    if (headers) {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown, request: Request): ErrorResponse {
    if (exception instanceof AppError) {
      const error: ErrorBody['error'] = { code: exception.code, message: exception.message };
      if (exception.details?.length) error.details = exception.details;
      return { status: exception.status, body: { error }, headers: exception.headers };
    }

    if (isJsonParseError(exception, request)) {
      return {
        status: 400,
        body: {
          error: {
            code: ErrorCode.VALIDATION_ERROR,
            message: ERROR_MESSAGES.VALIDATION_ERROR,
            details: [
              { field: 'body', type: 'INVALID_JSON', message: ERROR_MESSAGES.BODY_INVALID_JSON },
            ],
          },
        },
      };
    }

    if (exception instanceof HttpException && exception.getStatus() < 500) {
      const status = exception.getStatus();
      const code = status === 404 ? ErrorCode.NOT_FOUND : ErrorCode.VALIDATION_ERROR;
      const message = status === 404 ? ERROR_MESSAGES.NOT_FOUND : ERROR_MESSAGES.VALIDATION_ERROR;
      return { status, body: { error: { code, message } } };
    }

    this.logger.error(
      'Error no controlado',
      exception instanceof Error ? exception.stack : String(exception),
    );
    return {
      status: 500,
      body: { error: { code: ErrorCode.INTERNAL_ERROR, message: ERROR_MESSAGES.INTERNAL_ERROR } },
    };
  }
}
