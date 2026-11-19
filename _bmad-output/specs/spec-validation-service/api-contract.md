# Contrato de API

Todas las respuestas son `application/json`. Los errores siguen el formato `{ "error": { "code", "message", "details?" } }` (ver `error-handling.md`).

## POST /validations: registrar o verificar

**Body** (el mismo para registrar y para verificar)

| Campo | Tipo | Regla (Zod) |
|---|---|---|
| `name` | string | **Obligatorio** (nombre completo). trim; 2–100 caracteres; letras (con tildes y ñ), espacios, `'` y `-`, empezando por una letra: `/^\p{L}[\p{L} '-]*$/u` |
| `documentNumber` | string | **Obligatorio.** trim; `/^\d{6,12}$/` |
| `countryCode` | string | **Opcional.** trim; `/^[A-Za-z]{2}$/` (ISO 3166-1 alpha-2); se normaliza a mayúsculas. Ausente, `null` o vacío → no se evalúa el país (`NOT_EVALUATED`) |

No se aceptan campos adicionales (por ejemplo, `firstName` o `lastName`). Mínimo válido: `{ "name": "jhon garcia", "documentNumber": "1020304050" }` → `201 NOT_EVALUATED`.

**Request**
```http
POST /validations
Content-Type: application/json

{ "name": "Jhon Anderson García", "documentNumber": "1020304050", "countryCode": "co" }
```

**Extracción del primer nombre (servidor):** `firstNameSent = normalizeName(name).split(" ")[0]`. Con `"  Jhón Anderson García "` se obtiene `jhon`, y solo eso se envía a Nationalize. Enviar solo el primer nombre evita las predicciones diluidas y los errores que da la API con nombres completos. La cédula decide si se registra o se verifica.

### Cédula nueva → 201 Created (`outcome: REGISTERED`)

```json
{ "outcome": "REGISTERED", "id": "6745f1c2a9b8e4d3c2b1a0f9", "status": "APPROVED", "matchedProbability": 0.477529,
  "message": "Registro creado. El país ingresado coincide con la nacionalidad probable del nombre" }
```
```json
{ "outcome": "REGISTERED", "id": "6745f1c2a9b8e4d3c2b1a0fa", "status": "REJECTED", "matchedProbability": null,
  "message": "Registro creado. El país ingresado no coincide con la nacionalidad probable del nombre" }
```
```json
{ "outcome": "REGISTERED", "id": "6745f1c2a9b8e4d3c2b1a0fb", "status": "INCONCLUSIVE", "matchedProbability": null,
  "message": "Registro creado. No hay datos suficientes sobre el nombre para validar el país" }
```
```json
{ "outcome": "REGISTERED", "id": "6745f1c2a9b8e4d3c2b1a0fc", "status": "NOT_EVALUATED", "matchedProbability": null,
  "message": "Registro creado. No se evaluó el país porque no se ingresó un código de país" }
```

- `matchedProbability` es la probabilidad del `countryCode` en la predicción si aparece en ella (aunque quede por debajo del umbral), o `null` si no aparece.
- Cabecera `Location: /validations/{id}`.

### Cédula registrada y datos coincidentes → 200 OK (`outcome: VERIFIED`)

```json
{ "outcome": "VERIFIED", "id": "6745f1c2a9b8e4d3c2b1a0f9", "status": "APPROVED", "matchedProbability": 0.477529,
  "message": "Identidad verificada: los datos coinciden con el registro" }
```
`status` y `matchedProbability` son los del registro original. No se vuelve a consultar Nationalize.

### Cédula registrada y datos que no coinciden → 409 Conflict (alerta)

```json
{ "error": { "code": "IDENTITY_MISMATCH",
  "message": "Alerta: los datos ingresados no coinciden con el registro de este documento" } }
```
No se indica qué campo difiere ni se devuelven los datos guardados, para no filtrar información de la cédula. El detalle (`mismatchFields`) solo queda en la auditoría.

**Errores**

| Código | `error.code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body inválido, incompleto, con campos extra o JSON mal formado |
| 409 | `IDENTITY_MISMATCH` | La cédula existe, pero el nombre completo o el país (este solo si viene en la petición y está registrado) no coinciden |
| 422 | `NAME_NOT_PROCESSABLE` | Solo al registrar: Nationalize responde 422 (`Invalid 'name' parameter`) |
| 502 | `EXTERNAL_SERVICE_ERROR` | Solo al registrar: timeout, error de red, 5xx o respuesta inesperada tras 1 reintento; o 401/402 |
| 503 | `EXTERNAL_RATE_LIMITED` | Solo al registrar: Nationalize responde 429; cabecera `Retry-After` = `X-Rate-Limit-Reset` si viene |
| 500 | `AUDIT_WRITE_FAILED` | Falló DynamoDB (al registrar se compensa borrando el documento de Mongo) |
| 500 | `INTERNAL_ERROR` | Cualquier otro fallo (por ejemplo, Mongo caído) |

```json
// 400: se devuelven TODOS los errores a la vez, uno por campo y regla incumplida
{ "error": { "code": "VALIDATION_ERROR", "message": "Los datos enviados no son válidos",
  "details": [
    { "field": "name", "type": "REQUIRED", "message": "El nombre es obligatorio" },
    { "field": "documentNumber", "type": "INVALID_FORMAT", "message": "El número de documento solo puede contener dígitos" },
    { "field": "countryCode", "type": "INVALID_FORMAT", "message": "El código de país debe tener 2 letras (ISO 3166-1 alpha-2), por ejemplo \"CO\"" }
  ] } }
```
```json
// 422
{ "error": { "code": "NAME_NOT_PROCESSABLE", "message": "El servicio externo no pudo procesar el nombre",
  "details": [ { "field": "name", "type": "NOT_PROCESSABLE", "message": "El nombre no pudo ser analizado; revisa que sea un nombre real" } ] } }
```
```json
// 502
{ "error": { "code": "EXTERNAL_SERVICE_ERROR", "message": "El servicio de nacionalidad no está disponible, intenta más tarde" } }
```
```json
// 503
{ "error": { "code": "EXTERNAL_RATE_LIMITED", "message": "Se alcanzó el límite de consultas del servicio de nacionalidad, intenta más tarde" } }
```

### Catálogo de errores de entrada (retroalimentación al usuario)

Todo error de datos ingresados manualmente devuelve, en `details[]`, el **campo**, el **tipo de error** (`type`, estable para que lo use el frontend) y un **mensaje** en español listo para mostrar. No se devuelve el valor recibido, para no repetir datos personales.

| `field` | `type` | `message` |
|---|---|---|
| `name` | `REQUIRED` | El nombre es obligatorio |
| `name` | `INVALID_TYPE` | El nombre debe ser texto |
| `name` | `INVALID_FORMAT` | El nombre solo puede contener letras, espacios, apóstrofos y guiones, y debe empezar por una letra |
| `name` | `TOO_SHORT` | El nombre debe tener al menos 2 caracteres |
| `name` | `TOO_LONG` | El nombre no puede superar 100 caracteres |
| `name` | `NOT_PROCESSABLE` | El nombre no pudo ser analizado; revisa que sea un nombre real (422) |
| `documentNumber` | `REQUIRED` | El número de documento es obligatorio |
| `documentNumber` | `INVALID_TYPE` | El número de documento debe enviarse como texto |
| `documentNumber` | `INVALID_FORMAT` | El número de documento solo puede contener dígitos |
| `documentNumber` | `TOO_SHORT` | El número de documento debe tener al menos 6 dígitos |
| `documentNumber` | `TOO_LONG` | El número de documento no puede superar 12 dígitos |
| `countryCode` | `INVALID_TYPE` | El código de país debe ser texto |
| `countryCode` | `INVALID_FORMAT` | El código de país debe tener 2 letras (ISO 3166-1 alpha-2), por ejemplo "CO" |
| `<campo extra>` | `UNKNOWN_FIELD` | El campo '<campo>' no está permitido |
| `body` | `INVALID_JSON` | El cuerpo de la petición no es un JSON válido |
| `body` | `REQUIRED` | El cuerpo de la petición es obligatorio |
| `id` (GET) | `INVALID_FORMAT` | El id debe tener 24 caracteres hexadecimales |

- Un campo puede generar varios `details`: `"12a"` da a la vez `INVALID_FORMAT` y `TOO_SHORT`.
- `REQUIRED` cubre los campos obligatorios ausentes, `null` o vacíos tras el trim; en ese caso no se añaden más errores de ese campo.
- Un `REJECTED` **no** es un error de entrada: va en la respuesta `201` con su `message`.

## GET /validations/:id

**Request**
```http
GET /validations/6745f1c2a9b8e4d3c2b1a0f9
```

**200 OK**
```json
{
  "id": "6745f1c2a9b8e4d3c2b1a0f9",
  "name": "Jhon Anderson García",
  "firstNameSent": "jhon",
  "documentNumber": "1020304050",
  "countryCode": "CO",
  "nationality": {
    "topCountryId": "CO",
    "count": 199535,
    "countries": [
      { "countryId": "CO", "probability": 0.477529 },
      { "countryId": "PE", "probability": 0.148882 },
      { "countryId": "BO", "probability": 0.047131 },
      { "countryId": "EC", "probability": 0.026559 },
      { "countryId": "ES", "probability": 0.024411 }
    ]
  },
  "verification": { "status": "APPROVED", "matchedProbability": 0.477529, "threshold": 0.1 },
  "createdAt": "2026-11-18T15:04:05.123Z"
}
```
`nameNormalized` es interno y no se expone; `firstNameSent` sí, para auditar con qué valor se enriqueció. Sin país → `"countryCode": null` y `"verification": { "status": "NOT_EVALUATED", "matchedProbability": null, "threshold": 0.1 }`.

**Errores**

| Código | `error.code` | Cuándo |
|---|---|---|
| 400 | `INVALID_ID` | `:id` no es un ObjectId válido; lleva `details` con `field: "id"`, `type: "INVALID_FORMAT"` |
| 404 | `VALIDATION_NOT_FOUND` | No existe un registro con ese id |
| 500 | `INTERNAL_ERROR` | Fallo inesperado |
