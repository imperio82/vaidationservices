import { MismatchField, Outcome, VerificationStatus } from '../../domain/validation.entity';

export const AUDIT_REPOSITORY = Symbol('AUDIT_REPOSITORY');

/** Evento de auditoría de un intento (no guarda nombres). El adaptador genera el `eventId`. */
export interface AuditEvent {
  documentNumber: string;
  eventType: Outcome;
  validationId: string;
  status: VerificationStatus;
  /** País ingresado en este intento; se omite si no vino. */
  countryCode?: string | null;
  /** Solo en REGISTERED; se omite si es null. */
  matchedProbability?: number | null;
  /** Solo en MISMATCH_ALERT. */
  mismatchFields?: MismatchField[];
  eventAt: Date;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
}
