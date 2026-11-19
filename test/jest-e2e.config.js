/** Pruebas e2e: app Nest completa con Supertest, mongodb-memory-server y DynamoDB simulado. */
module.exports = {
  rootDir: '..',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  testMatch: ['<rootDir>/test/e2e/**/*.e2e-spec.ts'],
  transform: { '^.+\.ts$': 'ts-jest' },
  testTimeout: 60000,
};
