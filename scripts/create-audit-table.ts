/**
 * Crea la tabla de auditoría en DynamoDB Local. Es idempotente: si la tabla ya existe, no hace nada.
 * Uso: npm run table:create (lee DYNAMO_ENDPOINT, DYNAMO_TABLE, AWS_REGION y credenciales del entorno o de .env).
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';

function loadDotEnv(): void {
  const path = resolve(__dirname, '..', '.env');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const endpoint = process.env.DYNAMO_ENDPOINT ?? 'http://localhost:8000';
  const tableName = process.env.DYNAMO_TABLE ?? 'validation_audit';
  const client = new DynamoDBClient({
    endpoint,
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? 'local',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? 'local',
    },
  });

  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`La tabla "${tableName}" ya existe en ${endpoint}; no se hace nada.`);
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  await client.send(
    new CreateTableCommand({
      TableName: tableName,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [
        { AttributeName: 'documentNumber', AttributeType: 'S' },
        { AttributeName: 'sk', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'documentNumber', KeyType: 'HASH' },
        { AttributeName: 'sk', KeyType: 'RANGE' },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 30 }, { TableName: tableName });
  console.log(`Tabla "${tableName}" creada en ${endpoint}.`);
}

main().catch((error: unknown) => {
  console.error('No se pudo crear la tabla de auditoría:', error);
  process.exit(1);
});
