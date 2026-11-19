/** Tipos del dominio. Esta capa no importa nada externo. */

export const VerificationStatus = {
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  INCONCLUSIVE: 'INCONCLUSIVE',
  NOT_EVALUATED: 'NOT_EVALUATED',
} as const;
export type VerificationStatus = (typeof VerificationStatus)[keyof typeof VerificationStatus];

export const Outcome = {
  REGISTERED: 'REGISTERED',
  VERIFIED: 'VERIFIED',
  MISMATCH_ALERT: 'MISMATCH_ALERT',
} as const;
export type Outcome = (typeof Outcome)[keyof typeof Outcome];

export type MismatchField = 'name' | 'countryCode';

export interface CountryProbability {
  countryId: string;
  probability: number;
}

export interface Nationality {
  topCountryId: string | null;
  count: number;
  countries: CountryProbability[];
}

export interface Verification {
  status: VerificationStatus;
  matchedProbability: number | null;
  threshold: number;
}

/** Datos de una persona por registrar (sin id todavía). */
export interface NewValidation {
  name: string;
  nameNormalized: string;
  firstNameSent: string;
  documentNumber: string;
  countryCode: string | null;
  nationality: Nationality;
  verification: Verification;
  createdAt: Date;
}

/** Registro persistido: una persona por cédula. */
export interface Validation extends NewValidation {
  id: string;
}

/** Datos de entrada ya validados de un intento de registro o verificación. */
export interface ValidationInput {
  name: string;
  documentNumber: string;
  countryCode?: string | null;
}
