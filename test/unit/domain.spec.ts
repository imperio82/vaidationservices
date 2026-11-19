import {
  extractFirstName,
  matchIdentity,
  normalizeName,
} from '../../src/validations/domain/identity.rules';
import { verifyNationality } from '../../src/validations/domain/nationality.rules';
import { CountryProbability } from '../../src/validations/domain/validation.entity';

const JHON: CountryProbability[] = [
  { countryId: 'CO', probability: 0.477529 },
  { countryId: 'PE', probability: 0.148882 },
  { countryId: 'BO', probability: 0.047131 },
  { countryId: 'EC', probability: 0.026559 },
  { countryId: 'ES', probability: 0.024411 },
];
const THRESHOLD = 0.1;

describe('verifyNationality', () => {
  it('CO y PE → APPROVED (no hace falta ser el más probable)', () => {
    expect(verifyNationality('CO', JHON, THRESHOLD)).toEqual({
      status: 'APPROVED',
      matchedProbability: 0.477529,
      threshold: THRESHOLD,
    });
    expect(verifyNationality('PE', JHON, THRESHOLD).status).toBe('APPROVED');
  });

  it('BO → REJECTED con su probabilidad; AR → REJECTED con null', () => {
    expect(verifyNationality('BO', JHON, THRESHOLD)).toMatchObject({
      status: 'REJECTED',
      matchedProbability: 0.047131,
    });
    expect(verifyNationality('AR', JHON, THRESHOLD)).toMatchObject({
      status: 'REJECTED',
      matchedProbability: null,
    });
  });

  it('AC-6: probabilidad exactamente igual al umbral → APPROVED (límite inclusivo)', () => {
    expect(
      verifyNationality('CO', [{ countryId: 'CO', probability: 0.1 }], 0.1).status,
    ).toBe('APPROVED');
  });

  it('predicción vacía → INCONCLUSIVE', () => {
    expect(verifyNationality('CO', [], THRESHOLD)).toMatchObject({
      status: 'INCONCLUSIVE',
      matchedProbability: null,
    });
  });

  it('sin countryCode → NOT_EVALUATED', () => {
    expect(verifyNationality(null, JHON, THRESHOLD)).toEqual({
      status: 'NOT_EVALUATED',
      matchedProbability: null,
      threshold: THRESHOLD,
    });
    expect(verifyNationality(undefined, [], THRESHOLD).status).toBe('NOT_EVALUATED');
  });
});

describe('normalizeName / extractFirstName', () => {
  it('normaliza trim, minúsculas, tildes y espacios', () => {
    expect(normalizeName('  Jhón   Anderson  García ')).toBe('jhon anderson garcia');
    expect(normalizeName('ÑANDÚ')).toBe('nandu');
  });

  it('extrae solo la primera palabra normalizada', () => {
    expect(extractFirstName('  Jhón Anderson García ')).toBe('jhon');
  });
});

describe('matchIdentity (AC-8)', () => {
  it('"Jhon  García" coincide con "jhon garcia"', () => {
    expect(
      matchIdentity({ name: 'Jhon  García' }, { nameNormalized: 'jhon garcia', countryCode: null }),
    ).toEqual({ outcome: 'VERIFIED', mismatchFields: [] });
  });

  it('"jhon garcia" no coincide con "jhon garcia calvo" (nombre completo)', () => {
    expect(
      matchIdentity(
        { name: 'jhon garcia' },
        { nameNormalized: 'jhon garcia calvo', countryCode: null },
      ),
    ).toEqual({ outcome: 'MISMATCH_ALERT', mismatchFields: ['name'] });
  });

  it('el país solo se compara si existe en ambos lados', () => {
    const stored = { nameNormalized: 'jhon garcia', countryCode: 'CO' };
    expect(matchIdentity({ name: 'jhon garcia' }, stored).outcome).toBe('VERIFIED');
    expect(
      matchIdentity(
        { name: 'jhon garcia', countryCode: 'CO' },
        { nameNormalized: 'jhon garcia', countryCode: null },
      ).outcome,
    ).toBe('VERIFIED');
    expect(matchIdentity({ name: 'jhon garcia', countryCode: 'PE' }, stored)).toEqual({
      outcome: 'MISMATCH_ALERT',
      mismatchFields: ['countryCode'],
    });
    expect(matchIdentity({ name: 'pedro garcia', countryCode: 'PE' }, stored).mismatchFields).toEqual([
      'name',
      'countryCode',
    ]);
  });
});
