/** Pruebas unitarias: dominio y casos de uso con puertos falsos. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  passWithNoTests: true,
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/unit/**/*.spec.ts'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: 'coverage',
};
