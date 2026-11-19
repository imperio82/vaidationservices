import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { mockClient } from 'aws-sdk-client-mock';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Db } from 'mongodb';
import request from 'supertest';
import { NATIONALITY_PROVIDER } from '../../src/validations/application/ports/nationality.provider.port';
import {
  VALIDATION_REPOSITORY,
  ValidationRepository,
} from '../../src/validations/application/ports/validation.repository.port';
import { MONGO_DB } from '../../src/validations/infrastructure/clients.providers';
import { NationalizeProvider } from '../../src/validations/infrastructure/nationalize.provider';

/** Respuesta real de Nationalize para name=jhon (fixture). */
const JHON_FIXTURE = {
  count: 199535,
  name: 'jhon',
  country: [
    { country_id: 'CO', probability: 0.477529 },
    { country_id: 'PE', probability: 0.148882 },
    { country_id: 'BO', probability: 0.047131 },
    { country_id: 'EC', probability: 0.026559 },
    { country_id: 'ES', probability: 0.024411 },
  ],
};

type FakeBehavior = 'timeout' | 'network' | { status: number; body?: unknown; headers?: Record<string, string> };

/** Doble de `fetch` para Nationalize: nunca hay red real. */
class FakeNationalize {
  readonly calls: string[] = [];
  private queue: FakeBehavior[] = [];
  fallback: FakeBehavior = { status: 200, body: JHON_FIXTURE };

  reset(): void {
    this.calls.length = 0;
    this.queue = [];
    this.fallback = { status: 200, body: JHON_FIXTURE };
  }

  enqueue(...behaviors: FakeBehavior[]): void {
    this.queue.push(...behaviors);
  }

  readonly fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    this.calls.push(String(input));
    const behavior = this.queue.shift() ?? this.fallback;
    if (behavior === 'network') return Promise.reject(new TypeError('fetch failed'));
    if (behavior === 'timeout') {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('This operation was aborted', 'AbortError')),
        );
      });
    }
    const body = typeof behavior.body === 'string' ? behavior.body : JSON.stringify(behavior.body ?? {});
    return Promise.resolve(
      new Response(body, {
        status: behavior.status,
        headers: { 'content-type': 'application/json', ...behavior.headers },
      }),
    );
  };

  sentNames(): string[] {
    return this.calls.map((url) => new URL(url).searchParams.get('name') ?? '');
  }
}

describe('Validations API (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer;
  let db: Db;
  let repository: ValidationRepository;
  const nationalize = new FakeNationalize();
  const ddbMock = mockClient(DynamoDBDocumentClient);

  const putItems = (): Record<string, unknown>[] =>
    ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item as Record<string, unknown>);
  const countDocs = (documentNumber?: string): Promise<number> =>
    db.collection('validations').countDocuments(documentNumber ? { documentNumber } : {});
  const post = (body: unknown) => request(app.getHttpServer()).post('/validations').send(body as object);

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    Object.assign(process.env, {
      MONGO_URI: mongo.getUri('validations'),
      DYNAMO_ENDPOINT: 'http://localhost:8000',
      DYNAMO_TABLE: 'validation_audit',
      AWS_REGION: 'us-east-1',
      AWS_ACCESS_KEY_ID: 'local',
      AWS_SECRET_ACCESS_KEY: 'local',
      NATIONALIZE_BASE_URL: 'http://nationalize.test',
      MATCH_THRESHOLD: '0.10',
    });
    // El env debe existir antes de importar AppModule: ConfigModule lo valida al cargarse.
    const { AppModule } = await import('../../src/app.module');
    const { configureApp } = await import('../../src/app.setup');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(NATIONALITY_PROVIDER)
      .useValue(
        new NationalizeProvider({
          baseUrl: 'http://nationalize.test',
          timeoutMs: 100,
          fetchFn: nationalize.fetch,
        }),
      )
      .compile();
    app = configureApp(moduleRef.createNestApplication({ logger: false }));
    await app.init();
    db = app.get<Db>(MONGO_DB);
    repository = app.get<ValidationRepository>(VALIDATION_REPOSITORY);
  });

  afterAll(async () => {
    await app?.close();
    await mongo?.stop();
    ddbMock.restore();
  });

  beforeEach(() => {
    nationalize.reset();
    ddbMock.reset();
    ddbMock.on(PutCommand).resolves({});
    jest.restoreAllMocks();
  });

  describe('flujo registrar → verificar → alertar (cédula 1020304050)', () => {
    let registeredId: string;
    let registeredEventId: string;

    it('AC-1 ⭐ registra con país, APPROVED, guarda en Mongo y audita REGISTERED', async () => {
      const res = await post({ name: 'Jhon Anderson García', documentNumber: '1020304050', countryCode: 'co' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        outcome: 'REGISTERED',
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        status: 'APPROVED',
        matchedProbability: 0.477529,
        message: 'Registro creado. El país ingresado coincide con la nacionalidad probable del nombre',
      });
      expect(res.headers.location).toBe(`/validations/${res.body.id}`);
      registeredId = res.body.id;

      const doc = await db.collection('validations').findOne({ documentNumber: '1020304050' });
      expect(doc).toMatchObject({
        name: 'Jhon Anderson García',
        nameNormalized: 'jhon anderson garcia',
        firstNameSent: 'jhon',
        countryCode: 'CO',
        nationality: { topCountryId: 'CO', count: 199535 },
        verification: { status: 'APPROVED', matchedProbability: 0.477529, threshold: 0.1 },
      });
      expect(doc?.nationality.countries).toHaveLength(5);
      expect(doc?.createdAt).toBeInstanceOf(Date);

      const [item] = putItems();
      expect(putItems()).toHaveLength(1);
      expect(item).toMatchObject({
        documentNumber: '1020304050',
        eventType: 'REGISTERED',
        validationId: registeredId,
        status: 'APPROVED',
        countryCode: 'CO',
        matchedProbability: 0.477529,
      });
      expect(item.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(item.sk).toBe(`${item.eventAt}#${item.eventId}`);
      expect(item).not.toHaveProperty('name');
      expect(ddbMock.commandCalls(PutCommand)[0].args[0].input.ConditionExpression).toBe(
        'attribute_not_exists(sk)',
      );
      registeredEventId = item.eventId as string;
    });

    it('AC-7 ⭐ misma cédula con nombre equivalente → 200 VERIFIED sin llamar a Nationalize', async () => {
      const res = await post({ name: '  JHON  anderson GARCIA ', documentNumber: '1020304050', countryCode: 'CO' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        outcome: 'VERIFIED',
        id: registeredId,
        status: 'APPROVED',
        matchedProbability: 0.477529,
        message: 'Identidad verificada: los datos coinciden con el registro',
      });
      expect(nationalize.calls).toHaveLength(0);
      expect(await countDocs('1020304050')).toBe(1);
      const [item] = putItems();
      expect(item).toMatchObject({ eventType: 'VERIFIED', validationId: registeredId });
      expect(item.eventId).not.toBe(registeredEventId);
    });

    it('AC-9 ⭐ misma cédula con otro nombre → 409 IDENTITY_MISMATCH y auditoría MISMATCH_ALERT', async () => {
      const before = await db.collection('validations').findOne({ documentNumber: '1020304050' });
      const res = await post({ name: 'Pedro Anderson García', documentNumber: '1020304050', countryCode: 'CO' });

      expect(res.status).toBe(409);
      expect(res.body).toEqual({
        error: {
          code: 'IDENTITY_MISMATCH',
          message: 'Alerta: los datos ingresados no coinciden con el registro de este documento',
        },
      });
      expect(JSON.stringify(res.body)).not.toMatch(/jhon|CO"|name/i);
      expect(putItems()).toEqual([
        expect.objectContaining({
          eventType: 'MISMATCH_ALERT',
          validationId: registeredId,
          mismatchFields: ['name'],
        }),
      ]);
      expect(await db.collection('validations').findOne({ documentNumber: '1020304050' })).toEqual(before);
      expect(nationalize.calls).toHaveLength(0);
    });

    it('AC-10 país distinto → 409 con mismatchFields ["countryCode"]', async () => {
      const res = await post({ name: 'Jhon Anderson García', documentNumber: '1020304050', countryCode: 'PE' });
      expect(res.status).toBe(409);
      expect(putItems()[0].mismatchFields).toEqual(['countryCode']);
    });

    it('AC-11 nombre y país distintos → 409 con ambos campos', async () => {
      const res = await post({ name: 'Pedro García', documentNumber: '1020304050', countryCode: 'PE' });
      expect(res.status).toBe(409);
      expect(putItems()[0].mismatchFields).toEqual(['name', 'countryCode']);
    });

    it('AC-24 nombre igual y sin countryCode → 200 VERIFIED', async () => {
      const res = await post({ name: 'jhon anderson garcia', documentNumber: '1020304050' });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('VERIFIED');
    });

    it('AC-14 ⭐ GET devuelve el registro; id inexistente → 404; id mal formado → 400', async () => {
      const ok = await request(app.getHttpServer()).get(`/validations/${registeredId}`);
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual({
        id: registeredId,
        name: 'Jhon Anderson García',
        firstNameSent: 'jhon',
        documentNumber: '1020304050',
        countryCode: 'CO',
        nationality: {
          topCountryId: 'CO',
          count: 199535,
          countries: JHON_FIXTURE.country.map((c) => ({ countryId: c.country_id, probability: c.probability })),
        },
        verification: { status: 'APPROVED', matchedProbability: 0.477529, threshold: 0.1 },
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      });
      expect(ok.body).not.toHaveProperty('nameNormalized');

      const missing = await request(app.getHttpServer()).get('/validations/aaaaaaaaaaaaaaaaaaaaaaaa');
      expect(missing.status).toBe(404);
      expect(missing.body.error.code).toBe('VALIDATION_NOT_FOUND');

      const bad = await request(app.getHttpServer()).get('/validations/abc');
      expect(bad.status).toBe(400);
      expect(bad.body).toEqual({
        error: {
          code: 'INVALID_ID',
          message: expect.any(String),
          details: [
            { field: 'id', type: 'INVALID_FORMAT', message: 'El id debe tener 24 caracteres hexadecimales' },
          ],
        },
      });
    });
  });

  describe('veredictos de registro', () => {
    it('AC-2 PE → 201 APPROVED', async () => {
      const res = await post({ name: 'jhon garcia', documentNumber: '3000000002', countryCode: 'PE' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'APPROVED', matchedProbability: 0.148882 });
    });

    it('AC-3 BO → 201 REJECTED con su probabilidad', async () => {
      const res = await post({ name: 'jhon garcia', documentNumber: '3000000003', countryCode: 'BO' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED', matchedProbability: 0.047131 });
    });

    it('AC-4 ⭐ AR → 201 REJECTED con matchedProbability null; registro y auditoría persistidos', async () => {
      const res = await post({ name: 'jhon garcia', documentNumber: '3000000004', countryCode: 'AR' });
      expect(res.status).toBe(201);
      expect(res.body).toEqual({
        outcome: 'REGISTERED',
        id: expect.any(String),
        status: 'REJECTED',
        matchedProbability: null,
        message: 'Registro creado. El país ingresado no coincide con la nacionalidad probable del nombre',
      });
      expect(await countDocs('3000000004')).toBe(1);
      const [item] = putItems();
      expect(item).toMatchObject({ eventType: 'REGISTERED', status: 'REJECTED', validationId: res.body.id });
      expect(item).not.toHaveProperty('matchedProbability');
    });

    it('AC-12 cédula REJECTED verificada con datos iguales → 200 con status REJECTED', async () => {
      const res = await post({ name: 'Jhon García', documentNumber: '3000000004', countryCode: 'AR' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: 'VERIFIED', status: 'REJECTED' });
    });

    it('AC-5 predicción vacía → 201 INCONCLUSIVE', async () => {
      nationalize.enqueue({ status: 200, body: { count: 0, name: 'zzyx', country: [] } });
      const res = await post({ name: 'Zzyx Garcia', documentNumber: '3000000005', countryCode: 'CO' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'INCONCLUSIVE', matchedProbability: null });
    });

    it('AC-22 ⭐ a Nationalize solo se envía el primer nombre normalizado', async () => {
      const res = await post({ name: '  Jhón Anderson García ', documentNumber: '3000000022', countryCode: 'CO' });
      expect(res.status).toBe(201);
      expect(nationalize.calls).toHaveLength(1);
      expect(nationalize.calls[0]).toBe('http://nationalize.test/?name=jhon');
      expect(nationalize.sentNames()).toEqual(['jhon']);
      const doc = await db.collection('validations').findOne({ documentNumber: '3000000022' });
      expect(doc?.firstNameSent).toBe('jhon');
    });

    it('AC-23 mínimo válido sin país (también null y "") → 201 NOT_EVALUATED', async () => {
      const cases = [
        { name: 'jhon garcia', documentNumber: '3000000231' },
        { name: 'jhon garcia', documentNumber: '3000000232', countryCode: null },
        { name: 'jhon garcia', documentNumber: '3000000233', countryCode: '' },
      ];
      for (const body of cases) {
        const res = await post(body);
        expect(res.status).toBe(201);
        expect(res.body).toMatchObject({
          status: 'NOT_EVALUATED',
          matchedProbability: null,
          message: 'Registro creado. No se evaluó el país porque no se ingresó un código de país',
        });
        const doc = await db.collection('validations').findOne({ documentNumber: body.documentNumber });
        expect(doc).toMatchObject({ countryCode: null, nationality: { topCountryId: 'CO' } });
      }
      expect(nationalize.calls).toHaveLength(3);
    });

    it('AC-24 cédula sin país registrado verificada con countryCode → 200 VERIFIED', async () => {
      const res = await post({ name: 'jhon garcia', documentNumber: '3000000231', countryCode: 'CO' });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ outcome: 'VERIFIED', status: 'NOT_EVALUATED' });
    });
  });

  describe('entrada inválida', () => {
    it('AC-15 ⭐ devuelve todos los errores sin consultar Mongo ni Nationalize ni escribir', async () => {
      const findSpy = jest.spyOn(repository, 'findByDocumentNumber');
      const insertSpy = jest.spyOn(repository, 'insert');
      const docsBefore = await countDocs();

      const res = await post({ documentNumber: '12a', countryCode: 'COL', extra: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Los datos enviados no son válidos');
      const byKey = (d: { field: string; type: string }) => `${d.field}/${d.type}`;
      expect([...res.body.error.details].sort((a, b) => byKey(a).localeCompare(byKey(b)))).toEqual(
        [
          { field: 'countryCode', type: 'INVALID_FORMAT', message: 'El código de país debe tener 2 letras (ISO 3166-1 alpha-2), por ejemplo "CO"' },
          { field: 'documentNumber', type: 'INVALID_FORMAT', message: 'El número de documento solo puede contener dígitos' },
          { field: 'documentNumber', type: 'TOO_SHORT', message: 'El número de documento debe tener al menos 6 dígitos' },
          { field: 'extra', type: 'UNKNOWN_FIELD', message: "El campo 'extra' no está permitido" },
          { field: 'name', type: 'REQUIRED', message: 'El nombre es obligatorio' },
        ],
      );
      expect(findSpy).not.toHaveBeenCalled();
      expect(insertSpy).not.toHaveBeenCalled();
      expect(nationalize.calls).toHaveLength(0);
      expect(putItems()).toHaveLength(0);
      expect(await countDocs()).toBe(docsBefore);
    });

    it('AC-16 casos de formato, tipo, longitud, campos extra y JSON roto', async () => {
      const detailsOf = async (body: unknown) => {
        const res = await post(body);
        expect(res.status).toBe(400);
        return (res.body.error.details as { field: string; type: string }[]).map((d) => `${d.field}/${d.type}`);
      };
      const valid = { name: 'jhon garcia', documentNumber: '1234567' };

      const broken = await request(app.getHttpServer())
        .post('/validations')
        .set('Content-Type', 'application/json')
        .send('{"name": "jhon",');
      expect(broken.status).toBe(400);
      expect(broken.body).toEqual({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Los datos enviados no son válidos',
          details: [{ field: 'body', type: 'INVALID_JSON', message: 'El cuerpo de la petición no es un JSON válido' }],
        },
      });

      const empty = await request(app.getHttpServer()).post('/validations');
      expect(empty.status).toBe(400);
      expect(empty.body.error.details).toEqual([
        { field: 'body', type: 'REQUIRED', message: 'El cuerpo de la petición es obligatorio' },
      ]);

      expect(await detailsOf({ ...valid, documentNumber: '1234567890123' })).toEqual(['documentNumber/TOO_LONG']);
      expect(await detailsOf({ ...valid, documentNumber: 1234567 })).toEqual(['documentNumber/INVALID_TYPE']);
      expect(await detailsOf({ ...valid, name: 'Ana123' })).toEqual(['name/INVALID_FORMAT']);
      expect(await detailsOf({ ...valid, name: '-ana' })).toEqual(['name/INVALID_FORMAT']);
      expect(await detailsOf({ ...valid, name: 'a'.repeat(101) })).toEqual(['name/TOO_LONG']);
      expect(await detailsOf({ ...valid, firstName: 'jhon' })).toEqual(['firstName/UNKNOWN_FIELD']);
      expect(await detailsOf({ ...valid, name: '   ' })).toEqual(['name/REQUIRED']);
      expect(nationalize.calls).toHaveLength(0);
    });
  });

  describe('fallos de Nationalize', () => {
    it('AC-17 ⭐ timeout en ambos intentos → 502, exactamente 2 intentos y sin escrituras', async () => {
      nationalize.enqueue('timeout', 'timeout');
      const res = await post({ name: 'jhon garcia', documentNumber: '4000000171', countryCode: 'CO' });
      expect(res.status).toBe(502);
      expect(res.body).toEqual({
        error: {
          code: 'EXTERNAL_SERVICE_ERROR',
          message: 'El servicio de nacionalidad no está disponible, intenta más tarde',
        },
      });
      expect(nationalize.calls).toHaveLength(2);
      expect(await countDocs('4000000171')).toBe(0);
      expect(putItems()).toHaveLength(0);
    });

    it('AC-17 ⭐ 5xx en ambos intentos → 502 con 2 intentos; red caída también', async () => {
      nationalize.enqueue({ status: 503, body: { error: 'down' } }, { status: 500, body: { error: 'down' } });
      const res = await post({ name: 'jhon garcia', documentNumber: '4000000172', countryCode: 'CO' });
      expect(res.status).toBe(502);
      expect(nationalize.calls).toHaveLength(2);
      expect(JSON.stringify(res.body)).not.toContain('down');

      nationalize.reset();
      nationalize.enqueue('network', 'network');
      const net = await post({ name: 'jhon garcia', documentNumber: '4000000172', countryCode: 'CO' });
      expect(net.status).toBe(502);
      expect(nationalize.calls).toHaveLength(2);
      expect(await countDocs('4000000172')).toBe(0);
      expect(putItems()).toHaveLength(0);
    });

    it('AC-17 ⭐ falla una vez y luego responde → 201', async () => {
      nationalize.enqueue({ status: 502 });
      const res = await post({ name: 'jhon garcia', documentNumber: '4000000173', countryCode: 'CO' });
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('APPROVED');
      expect(nationalize.calls).toHaveLength(2);

      nationalize.reset();
      nationalize.enqueue('timeout');
      const afterTimeout = await post({ name: 'jhon garcia', documentNumber: '4000000174', countryCode: 'CO' });
      expect(afterTimeout.status).toBe(201);
      expect(nationalize.calls).toHaveLength(2);
    });

    it('AC-18 429 → 503 + Retry-After; 401 → 502; 422 → NAME_NOT_PROCESSABLE; 1 intento y sin escrituras', async () => {
      nationalize.enqueue({ status: 429, body: { error: 'Request limit reached' }, headers: { 'X-Rate-Limit-Reset': '60' } });
      const limited = await post({ name: 'jhon garcia', documentNumber: '4000000181' });
      expect(limited.status).toBe(503);
      expect(limited.headers['retry-after']).toBe('60');
      expect(limited.body.error.code).toBe('EXTERNAL_RATE_LIMITED');
      expect(nationalize.calls).toHaveLength(1);

      nationalize.reset();
      nationalize.enqueue({ status: 401, body: { error: 'Invalid API key' } });
      const unauthorized = await post({ name: 'jhon garcia', documentNumber: '4000000182' });
      expect(unauthorized.status).toBe(502);
      expect(unauthorized.body.error.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(nationalize.calls).toHaveLength(1);

      nationalize.reset();
      nationalize.enqueue({ status: 422, body: { error: "Invalid 'name' parameter" } });
      const unprocessable = await post({ name: 'jhon garcia', documentNumber: '4000000183' });
      expect(unprocessable.status).toBe(422);
      expect(unprocessable.body).toEqual({
        error: {
          code: 'NAME_NOT_PROCESSABLE',
          message: 'El servicio externo no pudo procesar el nombre',
          details: [
            { field: 'name', type: 'NOT_PROCESSABLE', message: 'El nombre no pudo ser analizado; revisa que sea un nombre real' },
          ],
        },
      });
      expect(nationalize.calls).toHaveLength(1);

      for (const doc of ['4000000181', '4000000182', '4000000183']) expect(await countDocs(doc)).toBe(0);
      expect(putItems()).toHaveLength(0);
    });
  });

  describe('fallos de auditoría', () => {
    it('AC-19 ⭐ Put rechazado al registrar → 500 AUDIT_WRITE_FAILED y el documento ya no existe', async () => {
      ddbMock.on(PutCommand).rejects(new Error('DynamoDB no disponible'));
      const res = await post({ name: 'jhon garcia', documentNumber: '5000000191', countryCode: 'CO' });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_WRITE_FAILED');
      expect(await countDocs('5000000191')).toBe(0);
    });

    it('AC-19 ⭐ Put rechazado al verificar → 500 AUDIT_WRITE_FAILED y Mongo sin cambios', async () => {
      const created = await post({ name: 'jhon garcia', documentNumber: '5000000192', countryCode: 'CO' });
      expect(created.status).toBe(201);
      const before = await db.collection('validations').findOne({ documentNumber: '5000000192' });

      ddbMock.on(PutCommand).rejects(new Error('DynamoDB no disponible'));
      const res = await post({ name: 'jhon garcia', documentNumber: '5000000192', countryCode: 'CO' });
      expect(res.status).toBe(500);
      expect(res.body.error.code).toBe('AUDIT_WRITE_FAILED');
      expect(await db.collection('validations').find({ documentNumber: '5000000192' }).toArray()).toEqual([before]);
    });
  });
});
