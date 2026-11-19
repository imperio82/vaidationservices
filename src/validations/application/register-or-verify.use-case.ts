import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { ERROR_MESSAGES } from '../../common/errors/error-messages';
import { maskDocument } from '../../common/logging/mask';
import { extractFirstName, matchIdentity, normalizeName } from '../domain/identity.rules';
import { verifyNationality } from '../domain/nationality.rules';
import { Outcome, Validation, ValidationInput } from '../domain/validation.entity';
import { AUDIT_REPOSITORY, AuditEvent, AuditRepository } from './ports/audit.repository.port';
import { NATIONALITY_PROVIDER, NationalityProvider } from './ports/nationality.provider.port';
import {
  DuplicateDocumentError,
  VALIDATION_REPOSITORY,
  ValidationRepository,
} from './ports/validation.repository.port';
import { MATCH_THRESHOLD } from './tokens';

export interface RegisterOrVerifyResult {
  outcome: Outcome;
  validation: Validation;
}

const auditWriteFailed = (): AppError =>
  new AppError(500, ErrorCode.AUDIT_WRITE_FAILED, ERROR_MESSAGES.AUDIT_WRITE_FAILED);

/**
 * Una persona por cédula: si la cédula es nueva, registra (enriquece, guarda y audita);
 * si ya existe, verifica contra lo registrado y audita, sin llamar a Nationalize ni escribir en Mongo.
 */
@Injectable()
export class RegisterOrVerifyUseCase {
  private readonly logger = new Logger(RegisterOrVerifyUseCase.name);

  constructor(
    @Inject(VALIDATION_REPOSITORY) private readonly validations: ValidationRepository,
    @Inject(AUDIT_REPOSITORY) private readonly audit: AuditRepository,
    @Inject(NATIONALITY_PROVIDER) private readonly nationality: NationalityProvider,
    @Inject(MATCH_THRESHOLD) private readonly threshold: number,
  ) {}

  async execute(input: ValidationInput): Promise<RegisterOrVerifyResult> {
    const existing = await this.validations.findByDocumentNumber(input.documentNumber);
    if (existing) return this.verify(existing, input);
    return this.register(input);
  }

  private async register(input: ValidationInput): Promise<RegisterOrVerifyResult> {
    const countryCode = input.countryCode ?? null;
    const firstNameSent = extractFirstName(input.name);
    const nationality = await this.nationality.predict(firstNameSent);
    const verification = verifyNationality(countryCode, nationality.countries, this.threshold);

    let validation: Validation;
    try {
      validation = await this.validations.insert({
        name: input.name,
        nameNormalized: normalizeName(input.name),
        firstNameSent,
        documentNumber: input.documentNumber,
        countryCode,
        nationality,
        verification,
        createdAt: new Date(),
      });
    } catch (error) {
      if (!(error instanceof DuplicateDocumentError)) throw error;
      // Carrera: otra petición registró la misma cédula entre la búsqueda y el insert.
      const winner = await this.validations.findByDocumentNumber(input.documentNumber);
      if (!winner) throw error;
      return this.verify(winner, input);
    }

    try {
      await this.audit.record({
        documentNumber: validation.documentNumber,
        eventType: Outcome.REGISTERED,
        validationId: validation.id,
        status: verification.status,
        countryCode,
        matchedProbability: verification.matchedProbability,
        eventAt: new Date(),
      });
    } catch (error) {
      this.logger.error(
        `Falló la auditoría REGISTERED de ${maskDocument(validation.documentNumber)}; se compensa borrando ${validation.id}`,
        error instanceof Error ? error.stack : String(error),
      );
      await this.compensate(validation.id);
      throw auditWriteFailed();
    }

    return { outcome: Outcome.REGISTERED, validation };
  }

  private async verify(stored: Validation, input: ValidationInput): Promise<RegisterOrVerifyResult> {
    const { outcome, mismatchFields } = matchIdentity(input, stored);
    const event: AuditEvent = {
      documentNumber: stored.documentNumber,
      eventType: outcome,
      validationId: stored.id,
      status: stored.verification.status,
      countryCode: input.countryCode ?? null,
      eventAt: new Date(),
    };
    if (outcome === Outcome.MISMATCH_ALERT) event.mismatchFields = mismatchFields;

    try {
      await this.audit.record(event);
    } catch (error) {
      this.logger.error(
        `Falló la auditoría ${outcome} de ${maskDocument(stored.documentNumber)}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw auditWriteFailed();
    }

    if (outcome === Outcome.MISMATCH_ALERT) {
      this.logger.warn(
        `MISMATCH_ALERT para ${maskDocument(stored.documentNumber)}: campos [${mismatchFields.join(', ')}]`,
      );
    }
    return { outcome, validation: stored };
  }

  private async compensate(id: string): Promise<void> {
    try {
      await this.validations.deleteById(id);
    } catch (error) {
      this.logger.error(
        `No se pudo borrar el registro ${id} tras fallar la auditoría; conciliar a mano`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
