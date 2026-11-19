import { z } from 'zod';
import { ERROR_MESSAGES } from '../../common/errors/error-messages';

/** Catálogo de mensajes de entrada (api-contract.md). Nunca se repite el valor recibido. */
export const MSG = {
  name: {
    REQUIRED: 'El nombre es obligatorio',
    INVALID_TYPE: 'El nombre debe ser texto',
    INVALID_FORMAT:
      'El nombre solo puede contener letras, espacios, apóstrofos y guiones, y debe empezar por una letra',
    TOO_SHORT: 'El nombre debe tener al menos 2 caracteres',
    TOO_LONG: 'El nombre no puede superar 100 caracteres',
    NOT_PROCESSABLE: ERROR_MESSAGES.NAME_NOT_PROCESSABLE_DETAIL,
  },
  documentNumber: {
    REQUIRED: 'El número de documento es obligatorio',
    INVALID_TYPE: 'El número de documento debe enviarse como texto',
    INVALID_FORMAT: 'El número de documento solo puede contener dígitos',
    TOO_SHORT: 'El número de documento debe tener al menos 6 dígitos',
    TOO_LONG: 'El número de documento no puede superar 12 dígitos',
  },
  countryCode: {
    INVALID_TYPE: 'El código de país debe ser texto',
    INVALID_FORMAT: 'El código de país debe tener 2 letras (ISO 3166-1 alpha-2), por ejemplo "CO"',
  },
  id: {
    INVALID_FORMAT: 'El id debe tener 24 caracteres hexadecimales',
  },
} as const;

const NAME_PATTERN = /^\p{L}[\p{L} '-]*$/u;
const DIGITS_PATTERN = /^\d+$/;
const COUNTRY_CODE_PATTERN = /^[A-Za-z]{2}$/;
export const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;

/**
 * En Zod 4 las reglas de longitud se ejecutan aunque una regla previa tenga `abort: true`.
 * Con este `when` solo corren si el campo no quedó abortado (por ejemplo, vacío tras el trim),
 * así un REQUIRED no viene acompañado de más errores del mismo campo.
 */
const notAborted = {
  when: (payload: { issues: ReadonlyArray<{ continue?: boolean }> }): boolean =>
    payload.issues.every((issue) => issue.continue === true),
};

const name = z
  .string({ error: (iss) => (iss.input == null ? MSG.name.REQUIRED : MSG.name.INVALID_TYPE) })
  .trim()
  // Unifica tildes enviadas en NFD (letra + diacrítico combinante) para que pasen NAME_PATTERN.
  .normalize('NFC')
  .min(1, { error: MSG.name.REQUIRED, abort: true })
  .min(2, { error: MSG.name.TOO_SHORT, ...notAborted })
  .max(100, { error: MSG.name.TOO_LONG, ...notAborted })
  .regex(NAME_PATTERN, { error: MSG.name.INVALID_FORMAT })
  .transform((value) => value.replace(/\s+/g, ' '));

// Formato y longitud van en reglas separadas (equivale a /^\d{6,12}$/) para que "12a"
// dé a la vez INVALID_FORMAT y TOO_SHORT, como pide el catálogo.
const documentNumber = z
  .string({
    error: (iss) =>
      iss.input == null ? MSG.documentNumber.REQUIRED : MSG.documentNumber.INVALID_TYPE,
  })
  .trim()
  .min(1, { error: MSG.documentNumber.REQUIRED, abort: true })
  .regex(DIGITS_PATTERN, { error: MSG.documentNumber.INVALID_FORMAT })
  .min(6, { error: MSG.documentNumber.TOO_SHORT, ...notAborted })
  .max(12, { error: MSG.documentNumber.TOO_LONG, ...notAborted });

// Ausente, null o vacío → no se evalúa el país (NOT_EVALUATED).
const countryCode = z.preprocess(
  (v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v),
  z
    .string({ error: MSG.countryCode.INVALID_TYPE })
    .trim()
    .regex(COUNTRY_CODE_PATTERN, { error: MSG.countryCode.INVALID_FORMAT })
    .toUpperCase()
    .optional(),
);

export const createValidationSchema = z.strictObject({ name, documentNumber, countryCode });

export type CreateValidationDto = z.infer<typeof createValidationSchema>;
