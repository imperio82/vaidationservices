# Flujo de datos

## Componentes

```mermaid
flowchart LR
  C[Cliente] -->|HTTP JSON| CT
  subgraph presentation
    CT[ValidationsController<br/>+ ZodValidationPipe<br/>+ HttpExceptionFilter]
  end
  subgraph application
    UC[RegisterOrVerifyUseCase<br/>GetValidationUseCase]
    P1[[ValidationRepository]]
    P2[[AuditRepository]]
    P3[[NationalityProvider]]
  end
  subgraph domain
    DR[verifyNationality<br/>matchIdentity · normalizeName]
  end
  subgraph infrastructure
    MR[MongoValidationRepository]
    DA[DynamoAuditRepository]
    NP[NationalizeProvider]
  end
  CT --> UC
  UC --> DR
  UC --> P1 & P2 & P3
  MR -. implementa .-> P1
  DA -. implementa .-> P2
  NP -. implementa .-> P3
  MR --> M[(MongoDB<br/>documentNumber único)]
  DA --> D[(DynamoDB Local<br/>validation_audit)]
  NP -->|GET ?name=| API[(Nationalize.io)]
```

Las dependencias apuntan hacia dentro: el caso de uso solo conoce los puertos, y `ValidationsModule` inyecta los adaptadores.

Solo el primer nombre normalizado (`firstNameSent`) sale hacia Nationalize, y solo al registrar. El nombre completo, `documentNumber` y `countryCode` no salen del servicio.

## POST /validations: registrar o verificar

```mermaid
flowchart TD
  A[POST /validations<br/>name, documentNumber, countryCode?] --> B{¿Body válido?<br/>Zod}
  B -- no --> E400[400 VALIDATION_ERROR<br/>details: field/type/message]
  B -- sí --> F{¿Cédula registrada<br/>en MongoDB?}

  F -- sí: VERIFICACIÓN --> I{¿nameNormalized completo coincide?<br/>countryCode: solo si viene y está registrado}
  I -- sí --> AV[Auditoría VERIFIED]
  AV --> R200[200 VERIFIED<br/>registro existente]
  I -- no --> AM[Auditoría MISMATCH_ALERT<br/>mismatchFields]
  AM --> R409[409 IDENTITY_MISMATCH<br/>alerta]
  AV -- falla --> E500A1[500 AUDIT_WRITE_FAILED]
  AM -- falla --> E500A1

  F -- no: REGISTRO --> C[Extraer primer nombre<br/>y consultar Nationalize]
  C --> C1{Respuesta}
  C1 -- timeout / red / 5xx --> C2{¿Ya reintentó?}
  C2 -- no --> C
  C2 -- sí --> E502[502 EXTERNAL_SERVICE_ERROR]
  C1 -- 401 / 402 / formato inesperado --> E502
  C1 -- 422 --> E422[422 NAME_NOT_PROCESSABLE]
  C1 -- 429 --> E503[503 EXTERNAL_RATE_LIMITED<br/>+ Retry-After]
  C1 -- 200 --> V{Regla de nacionalidad}
  V -- "country: []" --> INC[INCONCLUSIVE]
  V -- "countryCode con p ≥ umbral" --> APR[APPROVED]
  V -- otro caso --> REJ[REJECTED]
  V -- sin countryCode --> NE[NOT_EVALUATED]
  NE --> G
  INC --> G[insert en MongoDB]
  APR --> G
  REJ --> G
  G -- llave duplicada<br/>carrera --> I
  G -- otro fallo --> E500[500 INTERNAL_ERROR]
  G -- ok --> H[Auditoría REGISTERED]
  H -- falla --> K[borrar doc en Mongo<br/>compensación] --> E500A[500 AUDIT_WRITE_FAILED]
  H -- ok --> R201[201 REGISTERED<br/>id, status, matchedProbability, message]
```

- Las salidas 400, 422, 502 y 503 no escriben nada.
- Toda respuesta 201, 200 o 409 deja su evento en DynamoDB.
- Solo 201 escribe en MongoDB.

## POST: registro, camino feliz

```mermaid
sequenceDiagram
  autonumber
  participant C as Cliente
  participant R as ValidationsController (Zod pipe)
  participant S as RegisterOrVerifyUseCase
  participant M as MongoDB
  participant N as NationalizeProvider
  participant API as Nationalize.io
  participant D as DynamoDB Local

  C->>R: POST {name, documentNumber, countryCode?}
  R->>S: create(input normalizado)
  S->>M: findByDocumentNumber
  M-->>S: null
  S->>S: firstNameSent = primera palabra de normalizeName(name)
  S->>N: predict(firstNameSent)
  N->>API: GET /?name=jhon (timeout 3 s)
  API-->>N: {count, country:[{country_id, probability}]}
  N-->>S: nationality
  S->>S: verifyNationality → APPROVED / REJECTED / INCONCLUSIVE / NOT_EVALUATED
  S->>M: insertOne({name, nameNormalized, firstNameSent, ..., nationality, verification})
  M-->>S: _id
  S->>D: Put {PK: documentNumber, SK: eventAt#eventId, validationId, eventType: REGISTERED}
  S-->>C: 201 REGISTERED
```

## POST: verificación (cédula ya registrada)

```mermaid
sequenceDiagram
  autonumber
  participant C as Cliente
  participant S as RegisterOrVerifyUseCase
  participant M as MongoDB
  participant D as DynamoDB Local

  C->>S: POST {name, documentNumber, countryCode?}
  S->>M: findByDocumentNumber
  M-->>S: registro existente
  S->>S: matchIdentity(input, registro) → mismatchFields
  alt sin diferencias
    S->>D: Put {eventType: VERIFIED}
    S-->>C: 200 VERIFIED
  else nombre completo o país distinto
    S->>D: Put {eventType: MISMATCH_ALERT, mismatchFields}
    S-->>C: 409 IDENTITY_MISMATCH (alerta)
  end
```

## GET /validations/:id

```mermaid
flowchart LR
  A[GET /validations/:id] --> B{¿ObjectId válido?}
  B -- no --> E400[400 INVALID_ID]
  B -- sí --> C[findById en MongoDB]
  C -- null --> E404[404 VALIDATION_NOT_FOUND]
  C -- doc --> OK[200 registro completo]
```

GET no consulta Nationalize ni DynamoDB.
