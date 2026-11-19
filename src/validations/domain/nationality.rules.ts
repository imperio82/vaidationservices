import { CountryProbability, Verification, VerificationStatus } from './validation.entity';

/**
 * Regla de verificación de nacionalidad (registro). Pura, sin I/O.
 * El umbral es inclusivo: `matchedProbability >= threshold` aprueba.
 */
export function verifyNationality(
  countryCode: string | null | undefined,
  countries: CountryProbability[],
  threshold: number,
): Verification {
  const match = countryCode == null ? undefined : countries.find((c) => c.countryId === countryCode);
  const matchedProbability = match?.probability ?? null;

  let status: VerificationStatus;
  if (countryCode == null) status = VerificationStatus.NOT_EVALUATED;
  else if (countries.length === 0) status = VerificationStatus.INCONCLUSIVE;
  else if (matchedProbability !== null && matchedProbability >= threshold)
    status = VerificationStatus.APPROVED;
  else status = VerificationStatus.REJECTED;

  return { status, matchedProbability, threshold };
}
