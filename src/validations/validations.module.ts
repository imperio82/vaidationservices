import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Db } from 'mongodb';
import type { Env } from '../config/env.schema';
import { GetValidationUseCase } from './application/get-validation.use-case';
import { AUDIT_REPOSITORY } from './application/ports/audit.repository.port';
import { NATIONALITY_PROVIDER } from './application/ports/nationality.provider.port';
import { VALIDATION_REPOSITORY } from './application/ports/validation.repository.port';
import { RegisterOrVerifyUseCase } from './application/register-or-verify.use-case';
import { MATCH_THRESHOLD } from './application/tokens';
import { DYNAMO_DOCUMENT_CLIENT, MONGO_DB, clientProviders } from './infrastructure/clients.providers';
import { DynamoAuditRepository } from './infrastructure/dynamo-audit.repository';
import { MongoValidationRepository } from './infrastructure/mongo-validation.repository';
import { NationalizeProvider } from './infrastructure/nationalize.provider';
import { ValidationsController } from './presentation/validations.controller';

/** Conecta cada puerto con su adaptador mediante tokens de inyección. */
@Module({
  controllers: [ValidationsController],
  providers: [
    ...clientProviders,
    {
      provide: VALIDATION_REPOSITORY,
      inject: [MONGO_DB],
      useFactory: (db: Db) => new MongoValidationRepository(db),
    },
    {
      provide: AUDIT_REPOSITORY,
      inject: [DYNAMO_DOCUMENT_CLIENT, ConfigService],
      useFactory: (client: DynamoDBDocumentClient, config: ConfigService<Env, true>) =>
        new DynamoAuditRepository(client, config.get('DYNAMO_TABLE', { infer: true })),
    },
    {
      provide: NATIONALITY_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new NationalizeProvider({
          baseUrl: config.get('NATIONALIZE_BASE_URL', { infer: true }),
          apiKey: config.get('NATIONALIZE_API_KEY', { infer: true }),
          timeoutMs: config.get('NATIONALIZE_TIMEOUT_MS', { infer: true }),
        }),
    },
    {
      provide: MATCH_THRESHOLD,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => config.get('MATCH_THRESHOLD', { infer: true }),
    },
    RegisterOrVerifyUseCase,
    GetValidationUseCase,
  ],
})
export class ValidationsModule {}
