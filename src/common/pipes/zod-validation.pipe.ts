import { PipeTransform } from '@nestjs/common';
import type { ZodType, core } from 'zod';
import { AppError, ErrorCode, ErrorDetail } from '../errors/app-error';
import { ERROR_MESSAGES } from '../errors/error-messages';

/** Traduce un issue de Zod al `type` estable del catálogo (tabla de stack.md). */
function issueType(issue: core.$ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return issue.input == null ? 'REQUIRED' : 'INVALID_TYPE';
    case 'too_small':
      return Number(issue.minimum) === 1 ? 'REQUIRED' : 'TOO_SHORT';
    case 'too_big':
      return 'TOO_LONG';
    case 'invalid_format':
    default:
      return 'INVALID_FORMAT';
  }
}

/** Convierte los issues de Zod en `details[]`, uno por campo y regla incumplida. */
export function toErrorDetails(issues: core.$ZodIssue[]): ErrorDetail[] {
  const details: ErrorDetail[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      for (const key of issue.keys) {
        details.push({ field: key, type: 'UNKNOWN_FIELD', message: ERROR_MESSAGES.UNKNOWN_FIELD(key) });
      }
      continue;
    }
    const field = issue.path.length > 0 ? String(issue.path[0]) : 'body';
    details.push({ field, type: issueType(issue), message: issue.message });
  }
  return details;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Pipe de validación del body: rechaza antes de cualquier efecto y devuelve todos los errores a la vez. */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    if (!isPlainObject(value)) {
      throw new AppError(400, ErrorCode.VALIDATION_ERROR, ERROR_MESSAGES.VALIDATION_ERROR, [
        { field: 'body', type: 'REQUIRED', message: ERROR_MESSAGES.BODY_REQUIRED },
      ]);
    }
    // reportInput deja `input` en los issues para distinguir REQUIRED de INVALID_TYPE;
    // el valor nunca se devuelve al cliente.
    const result = this.schema.safeParse(value, { reportInput: true });
    if (!result.success) {
      throw new AppError(
        400,
        ErrorCode.VALIDATION_ERROR,
        ERROR_MESSAGES.VALIDATION_ERROR,
        toErrorDetails(result.error.issues),
      );
    }
    return result.data;
  }
}
