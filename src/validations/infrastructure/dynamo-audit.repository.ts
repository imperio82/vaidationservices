import { randomUUID } from 'node:crypto';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { AuditEvent, AuditRepository } from '../application/ports/audit.repository.port';

/**
 * Adaptador de DynamoDB Local. PK = documentNumber, SK = eventAt#eventId (UUID nuevo por evento).
 * El Put es condicional para no sobrescribir eventos. No guarda nombres.
 */
export class DynamoAuditRepository implements AuditRepository {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async record(event: AuditEvent): Promise<void> {
    const eventId = randomUUID();
    const eventAt = event.eventAt.toISOString();
    const item: Record<string, unknown> = {
      documentNumber: event.documentNumber,
      sk: `${eventAt}#${eventId}`,
      eventId,
      eventType: event.eventType,
      validationId: event.validationId,
      status: event.status,
      eventAt,
    };
    if (event.countryCode != null) item.countryCode = event.countryCode;
    if (event.eventType === 'REGISTERED' && event.matchedProbability != null) {
      item.matchedProbability = event.matchedProbability;
    }
    if (event.eventType === 'MISMATCH_ALERT' && event.mismatchFields) {
      item.mismatchFields = event.mismatchFields;
    }

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(sk)',
      }),
    );
  }
}
