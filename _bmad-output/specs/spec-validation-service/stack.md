# Stack y estructura

| Área | Elección |
|---|---|
| Lenguaje | TypeScript (strict), Node.js 20 LTS |
| Framework | NestJS (adaptador HTTP Express por defecto) |
| Validación | **Zod 4.1.12**, fijado exacto en `package.json` (`"zod": "4.1.12"`, sin `^`), mediante un `ZodValidationPipe` propio; sin `class-validator` |
| HTTP saliente | `fetch` nativo + `AbortController` (timeout de 3 s) |
| MongoDB | driver oficial `mongodb`, expuesto como provider; sin Mongoose |
| DynamoDB | `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` apuntando a `DYNAMO_ENDPOINT` |
| Config | `@nestjs/config` + esquema Zod del env |
| Pruebas | Jest (ts-jest) + `@nestjs/testing` + Supertest + mongodb-memory-server + aws-sdk-client-mock |
| Infra local | docker-compose: `mongo:7` (27017) y `amazon/dynamodb-local` (8000) |

## Capas (Clean Architecture con medida)

```
src/
  main.ts                                  # bootstrap Nest: filtro global, listen
  app.module.ts
  config/env.schema.ts                     # validación Zod del env
  validations/
    validations.module.ts                  # conecta cada puerto con su adaptador (tokens de inyección)
    domain/
      validation.entity.ts                 # tipos: Validation, Nationality, VerificationStatus, Outcome
      nationality.rules.ts                 # verifyNationality (pura)
      identity.rules.ts                    # matchIdentity, normalizeName, extractFirstName (puras)
    application/
      ports/validation.repository.port.ts  # findByDocumentNumber, insert, findById, deleteById
      ports/audit.repository.port.ts       # record(event)
      ports/nationality.provider.port.ts   # predict(name)
      register-or-verify.use-case.ts       # orquesta registro/verificación/compensación
      get-validation.use-case.ts
    infrastructure/
      mongo-validation.repository.ts
      dynamo-audit.repository.ts
      nationalize.provider.ts              # timeout, reintento, mapeo de errores
    presentation/
      validations.controller.ts            # POST / GET, mapea outcome → 201/200/409
      validation.schema.ts                 # esquemas Zod + catálogo de mensajes
  common/
    errors/app-error.ts
    errors/http-exception.filter.ts        # formato { error: { code, message, details? } }
    pipes/zod-validation.pipe.ts
scripts/create-audit-table.ts
test/
  unit/                                    # dominio y casos de uso con puertos falsos
  e2e/                                     # Supertest sobre la app Nest con providers sobrescritos
docker-compose.yml
.env.example
```

## Reglas de dependencia

- `domain` no importa nada: ni Nest, ni librerías, ni otras capas.
- `application` solo importa `domain` y sus propios puertos (interfaces); recibe los adaptadores por inyección con tokens (`@Inject(VALIDATION_REPOSITORY)`).
- `infrastructure` implementa los puertos; es la única capa que conoce MongoDB, DynamoDB y `fetch`.
- `presentation` solo conoce los casos de uso y los esquemas; no contiene lógica de negocio.
- Sin CQRS, bus de eventos ni mappers genéricos: solo lo que piden dos endpoints.

## Zod 4.1.12: mensajes personalizados

Se usa la API de Zod 4: el parámetro unificado `error`. No se usan `message`, `required_error` ni `invalid_type_error`, que son de Zod 3.

- **Objeto:** `z.strictObject({...})`. Cada clave extra genera un issue `unrecognized_keys`, que se traduce en un `UNKNOWN_FIELD` por clave.
- **Tipo y presencia:** `z.string({ error: (iss) => iss.input == null ? MSG.name.REQUIRED : MSG.name.INVALID_TYPE })`.
- **Vacío tras el trim:** `.trim().min(1, { error: MSG.x.REQUIRED, abort: true })`.
- **Resto de reglas:** `.min(n, { error })`, `.max(n, { error })` y `.regex(re, { error })`, todas con mensajes del catálogo. `name` colapsa los espacios internos con `.transform`; `countryCode` aplica `.toUpperCase()`.
- **Opcional** (`countryCode`): `z.preprocess(v => v === null || (typeof v === "string" && v.trim() === "") ? undefined : v, schema.optional())`.
- **Mapeo de issue a `type`** en el pipe:

  | Issue de Zod | `type` |
  |---|---|
  | `invalid_type` con `input` nulo o ausente; `too_small` con `minimum: 1` | `REQUIRED` |
  | `invalid_type` | `INVALID_TYPE` |
  | `too_small` | `TOO_SHORT` |
  | `too_big` | `TOO_LONG` |
  | `invalid_format` | `INVALID_FORMAT` |
  | `unrecognized_keys` | `UNKNOWN_FIELD` |

  El `field` sale de `issue.path[0]`, o de cada clave en `unrecognized_keys`. El `message` es el `issue.message` que ya fijó `error`.

## Variables de entorno

`PORT=3000`, `MONGO_URI=mongodb://localhost:27017/validations`, `DYNAMO_ENDPOINT=http://localhost:8000`, `DYNAMO_TABLE=validation_audit`, `AWS_REGION=us-east-1`, `AWS_ACCESS_KEY_ID=local`, `AWS_SECRET_ACCESS_KEY=local`, `NATIONALIZE_BASE_URL=https://api.nationalize.io`, `NATIONALIZE_API_KEY=` (opcional; la API funciona sin ella), `NATIONALIZE_TIMEOUT_MS=3000`, `MATCH_THRESHOLD=0.10` (rango [0, 1]).
