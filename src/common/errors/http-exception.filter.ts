import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
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

/** Error del body parser de Express cuando el JSON está mal formado. */
function isJsonParseError(exception: unknown): boolean {
  return (
    typeof exception === 'object' &&
    exception !== null &&
    (exception as { type?: unknown }).type === 'entity.parse.failed'
  );
}

/** Filtro global: toda respuesta de error sale con el formato `{ error: { code, message, details? } }`. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, body, headers } = this.toResponse(exception);
    if (headers) {
      for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
    }
    response.status(status).json(body);
  }

  private toResponse(exception: unknown): ErrorResponse {
    if (exception instanceof AppError) {
      const error: ErrorBody['error'] = { code: exception.code, message: exception.message };
      if (exception.details?.length) error.details = exception.details;
      return { status: exception.status, body: { error }, headers: exception.headers };
    }

    if (isJsonParseError(exception)) {
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
