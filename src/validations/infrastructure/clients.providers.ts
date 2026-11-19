import { Logger, OnApplicationShutdown, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Db, MongoClient } from 'mongodb';
import type { Env } from '../../config/env.schema';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const MONGO_DB = Symbol('MONGO_DB');
export const DYNAMO_DOCUMENT_CLIENT = Symbol('DYNAMO_DOCUMENT_CLIENT');

/** Cierra la conexión de Mongo al apagar la app. */
export class MongoConnectionCloser implements OnApplicationShutdown {
  private readonly logger = new Logger('MongoConnection');
  constructor(private readonly client: MongoClient) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.close();
    this.logger.log('Conexión a MongoDB cerrada');
  }
}

export const clientProviders: Provider[] = [
  {
    provide: MONGO_CLIENT,
    inject: [ConfigService],
    useFactory: async (config: ConfigService<Env, true>): Promise<MongoClient> => {
      const client = new MongoClient(config.get('MONGO_URI', { infer: true }), {
        serverSelectionTimeoutMS: 5000,
      });
      await client.connect();
      return client;
    },
  },
  {
    provide: MONGO_DB,
    inject: [MONGO_CLIENT],
    // Usa la base de datos indicada en MONGO_URI.
    useFactory: (client: MongoClient): Db => client.db(),
  },
  {
    provide: MongoConnectionCloser,
    inject: [MONGO_CLIENT],
    useFactory: (client: MongoClient) => new MongoConnectionCloser(client),
  },
  {
    provide: DYNAMO_DOCUMENT_CLIENT,
    inject: [ConfigService],
    useFactory: (config: ConfigService<Env, true>): DynamoDBDocumentClient =>
      DynamoDBDocumentClient.from(
        new DynamoDBClient({
          endpoint: config.get('DYNAMO_ENDPOINT', { infer: true }),
          region: config.get('AWS_REGION', { infer: true }),
          credentials: {
            accessKeyId: config.get('AWS_ACCESS_KEY_ID', { infer: true }),
            secretAccessKey: config.get('AWS_SECRET_ACCESS_KEY', { infer: true }),
          },
        }),
        { marshallOptions: { removeUndefinedValues: true } },
      ),
  },
];
