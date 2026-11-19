import { AppError } from '../../src/common/errors/app-error';
import { GetValidationUseCase } from '../../src/validations/application/get-validation.use-case';
import { AuditEvent, AuditRepository } from '../../src/validations/application/ports/audit.repository.port';
import { NationalityProvider } from '../../src/validations/application/ports/nationality.provider.port';
import {
  DuplicateDocumentError,
  ValidationRepository,
} from '../../src/validations/application/ports/validation.repository.port';
import { RegisterOrVerifyUseCase } from '../../src/validations/application/register-or-verify.use-case';
import { NewValidation, Nationality, Validation } from '../../src/validations/domain/validation.entity';

const JHON: Nationality = {
  topCountryId: 'CO',
  count: 199535,
  countries: [
    { countryId: 'CO', probability: 0.477529 },
    { countryId: 'PE', probability: 0.148882 },
    { countryId: 'BO', probability: 0.047131 },
    { countryId: 'EC', probability: 0.026559 },
    { countryId: 'ES', probability: 0.024411 },
  ],
};

class FakeValidationRepository implements ValidationRepository {
  readonly docs = new Map<string, Validation>();
  private seq = 0;
  insertHook?: (v: NewValidation) => void;

  async findByDocumentNumber(documentNumber: string): Promise<Validation | null> {
    return [...this.docs.values()].find((d) => d.documentNumber === documentNumber) ?? null;
  }
  async insert(v: NewValidation): Promise<Validation> {
    this.insertHook?.(v);
    if (await this.findByDocumentNumber(v.documentNumber)) throw new DuplicateDocumentError();
    const saved = { ...v, id: (++this.seq).toString(16).padStart(24, '0') };
    this.docs.set(saved.id, saved);
    return saved;
  }
  async findById(id: string): Promise<Validation | null> {
    return this.docs.get(id) ?? null;
  }
  async deleteById(id: string): Promise<void> {
    this.docs.delete(id);
  }
}

class FakeAudit implements AuditRepository {
  readonly events: AuditEvent[] = [];
  fail = false;
  async record(event: AuditEvent): Promise<void> {
    if (this.fail) throw new Error('DynamoDB caído');
    this.events.push(event);
  }
}

class FakeProvider implements NationalityProvider {
  readonly calls: string[] = [];
  result: Nationality | Error = JHON;
  async predict(firstName: string): Promise<Nationality> {
    this.calls.push(firstName);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

describe('RegisterOrVerifyUseCase', () => {
  let repo: FakeValidationRepository;
  let audit: FakeAudit;
  let provider: FakeProvider;
  let useCase: RegisterOrVerifyUseCase;

  const base = { name: 'Jhon Anderson García', documentNumber: '1020304050', countryCode: 'CO' };

  beforeEach(() => {
    repo = new FakeValidationRepository();
    audit = new FakeAudit();
    provider = new FakeProvider();
    useCase = new RegisterOrVerifyUseCase(repo, audit, provider, 0.1);
  });

  it('registra una cédula nueva, envía solo el primer nombre y audita REGISTERED', async () => {
    const result = await useCase.execute({ ...base, name: '  Jhón Anderson García ' });
    expect(result.outcome).toBe('REGISTERED');
    expect(provider.calls).toEqual(['jhon']);
    expect(result.validation).toMatchObject({
      firstNameSent: 'jhon',
      nameNormalized: 'jhon anderson garcia',
      countryCode: 'CO',
      verification: { status: 'APPROVED', matchedProbability: 0.477529, threshold: 0.1 },
    });
    expect(audit.events).toEqual([
      expect.objectContaining({
        eventType: 'REGISTERED',
        validationId: result.validation.id,
        status: 'APPROVED',
        matchedProbability: 0.477529,
      }),
    ]);
  });

  it('sin countryCode registra NOT_EVALUATED y guarda la predicción', async () => {
    const result = await useCase.execute({ name: 'jhon garcia', documentNumber: '2030405060' });
    expect(result.validation.verification.status).toBe('NOT_EVALUATED');
    expect(result.validation.countryCode).toBeNull();
    expect(result.validation.nationality).toEqual(JHON);
  });

  it('cédula existente con datos coincidentes → VERIFIED sin llamar al proveedor ni escribir', async () => {
    const { validation } = await useCase.execute(base);
    provider.calls.length = 0;
    const result = await useCase.execute({ ...base, name: '  JHON  anderson GARCIA ' });
    expect(result).toEqual({ outcome: 'VERIFIED', validation });
    expect(provider.calls).toEqual([]);
    expect(repo.docs.size).toBe(1);
    expect(audit.events[1]).toMatchObject({ eventType: 'VERIFIED', validationId: validation.id });
  });

  it('cédula existente con datos distintos → MISMATCH_ALERT con mismatchFields en la auditoría', async () => {
    await useCase.execute(base);
    const result = await useCase.execute({ ...base, name: 'Pedro Anderson García', countryCode: 'PE' });
    expect(result.outcome).toBe('MISMATCH_ALERT');
    expect(audit.events[1]).toMatchObject({
      eventType: 'MISMATCH_ALERT',
      mismatchFields: ['name', 'countryCode'],
    });
    expect(provider.calls).toHaveLength(1);
  });

  it('AC-13: si insert lanza llave duplicada, relee y sigue por verificación', async () => {
    const winner: Validation = {
      id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
      name: 'Jhon Anderson García',
      nameNormalized: 'jhon anderson garcia',
      firstNameSent: 'jhon',
      documentNumber: base.documentNumber,
      countryCode: 'CO',
      nationality: JHON,
      verification: { status: 'APPROVED', matchedProbability: 0.477529, threshold: 0.1 },
      createdAt: new Date(),
    };
    // Simula que otra petición insertó la cédula justo antes que esta.
    repo.insertHook = () => repo.docs.set(winner.id, winner);

    const verified = await useCase.execute(base);
    expect(verified).toEqual({ outcome: 'VERIFIED', validation: winner });

    repo.docs.clear();
    repo.insertHook = () => repo.docs.set(winner.id, winner);
    const alert = await useCase.execute({ ...base, name: 'Pedro García' });
    expect(alert.outcome).toBe('MISMATCH_ALERT');
    expect(audit.events.map((e) => e.eventType)).toEqual(['VERIFIED', 'MISMATCH_ALERT']);
  });

  it('si falla la auditoría al registrar, compensa borrando el documento y lanza AUDIT_WRITE_FAILED', async () => {
    audit.fail = true;
    await expect(useCase.execute(base)).rejects.toMatchObject({
      status: 500,
      code: 'AUDIT_WRITE_FAILED',
    });
    expect(repo.docs.size).toBe(0);
  });

  it('si falla la auditoría al verificar, lanza AUDIT_WRITE_FAILED sin tocar el registro', async () => {
    const { validation } = await useCase.execute(base);
    audit.fail = true;
    await expect(useCase.execute(base)).rejects.toMatchObject({ code: 'AUDIT_WRITE_FAILED' });
    expect([...repo.docs.values()]).toEqual([validation]);
  });

  it('si el proveedor falla, no hay escrituras', async () => {
    provider.result = new AppError(502, 'EXTERNAL_SERVICE_ERROR', 'x');
    await expect(useCase.execute(base)).rejects.toMatchObject({ code: 'EXTERNAL_SERVICE_ERROR' });
    expect(repo.docs.size).toBe(0);
    expect(audit.events).toEqual([]);
  });
});

describe('GetValidationUseCase', () => {
  it('devuelve el registro o lanza VALIDATION_NOT_FOUND', async () => {
    const repo = new FakeValidationRepository();
    const useCase = new GetValidationUseCase(repo);
    await expect(useCase.execute('bbbbbbbbbbbbbbbbbbbbbbbb')).rejects.toMatchObject({
      status: 404,
      code: 'VALIDATION_NOT_FOUND',
    });
  });
});
