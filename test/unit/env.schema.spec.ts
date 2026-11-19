import { validateEnv } from '../../src/config/env.schema';

const base = {
  MONGO_URI: 'mongodb://localhost:27017/validations',
  DYNAMO_ENDPOINT: 'http://localhost:8000',
  DYNAMO_TABLE: 'validation_audit',
  AWS_REGION: 'us-east-1',
  AWS_ACCESS_KEY_ID: 'local',
  AWS_SECRET_ACCESS_KEY: 'local',
};

describe('validateEnv', () => {
  it('variables numéricas vacías usan su valor por defecto', () => {
    const env = validateEnv({ ...base, MATCH_THRESHOLD: '', PORT: '  ', NATIONALIZE_TIMEOUT_MS: '' });
    expect(env.MATCH_THRESHOLD).toBe(0.1);
    expect(env.PORT).toBe(3000);
    expect(env.NATIONALIZE_TIMEOUT_MS).toBe(3000);
  });

  it('PORT fuera de rango falla', () => {
    expect(() => validateEnv({ ...base, PORT: '70000' })).toThrow(/PORT/);
  });

  it('sin MONGO_URI falla al arrancar', () => {
    const { MONGO_URI: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/MONGO_URI/);
  });
});
