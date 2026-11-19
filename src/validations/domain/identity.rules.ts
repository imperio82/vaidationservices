import { MismatchField, Outcome } from './validation.entity';

/** trim, minúsculas, sin tildes y espacios internos colapsados. */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/** Primer nombre normalizado: lo único que se envía a Nationalize. */
export function extractFirstName(name: string): string {
  return normalizeName(name).split(' ')[0];
}

export interface IdentityMatch {
  outcome: typeof Outcome.VERIFIED | typeof Outcome.MISMATCH_ALERT;
  mismatchFields: MismatchField[];
}

/**
 * Regla de coincidencia de identidad (cédula ya registrada). Pura.
 * Compara el nombre completo normalizado; el país solo si existe en la petición y en el registro.
 */
export function matchIdentity(
  input: { name: string; countryCode?: string | null },
  stored: { nameNormalized: string; countryCode: string | null },
): IdentityMatch {
  const mismatchFields: MismatchField[] = [];
  if (normalizeName(input.name) !== stored.nameNormalized) mismatchFields.push('name');
  if (
    input.countryCode != null &&
    stored.countryCode != null &&
    input.countryCode !== stored.countryCode
  ) {
    mismatchFields.push('countryCode');
  }
  return {
    outcome: mismatchFields.length === 0 ? Outcome.VERIFIED : Outcome.MISMATCH_ALERT,
    mismatchFields,
  };
}
