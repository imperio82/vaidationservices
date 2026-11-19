/** Detalle de un error de entrada: campo, tipo estable para el frontend y mensaje en español. */
export interface ErrorDetail {
  field: string;
  type: string;
  message: string;
}

/** Códigos de error que expone la API. */
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_ID: 'INVALID_ID',
  VALIDATION_NOT_FOUND: 'VALIDATION_NOT_FOUND',
  IDENTITY_MISMATCH: 'IDENTITY_MISMATCH',
  NAME_NOT_PROCESSABLE: 'NAME_NOT_PROCESSABLE',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  EXTERNAL_RATE_LIMITED: 'EXTERNAL_RATE_LIMITED',
  AUDIT_WRITE_FAILED: 'AUDIT_WRITE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_FOUND: 'NOT_FOUND',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Error tipado que lanzan las capas inferiores; el filtro global lo serializa como
 * `{ error: { code, message, details? } }`.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: ErrorDetail[],
    readonly headers?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
