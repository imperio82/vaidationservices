# Servicio de validaciones

Servicio Node.js (NestJS + TypeScript) que **registra o verifica personas por cédula**:

- `POST /validations` recibe un nombre completo, un número de documento y, opcionalmente, un código de país.
  - **Cédula nueva → registro (`201`)**: el servidor extrae el primer nombre, consulta [Nationalize.io](https://nationalize.io) **solo con él**, compara la nacionalidad probable con el país declarado (si viene), emite un veredicto y guarda a la persona en MongoDB.
  - **Cédula ya registrada → verificación**: compara el nombre completo y el país con lo registrado. Si coinciden responde `200 VERIFIED`; si no, `409 IDENTITY_MISMATCH` (alerta).
- `GET /validations/:id` devuelve un registro.
- Cada intento procesado por POST (registro, verificación o alerta) queda auditado en **DynamoDB Local**.

> **Una persona por cédula.** `documentNumber` es único. Una cédula repetida responde `200 VERIFIED` o `409 IDENTITY_MISMATCH`, **nunca crea otro registro**, no vuelve a consultar Nationalize y no modifica el registro existente.

## Inicio rápido (un solo comando)

Solo necesitas Docker con Docker Compose:

```bash
docker compose up --build
```

Esto levanta MongoDB, DynamoDB Local, crea la tabla de auditoría y arranca el servicio en `http://localhost:3000`. No hace falta instalar Node ni crear `.env`.

Cuando en la consola aparezca `Servicio de validaciones escuchando en el puerto 3000`, el servicio está listo.

### Probar con Postman (recomendado)

1. Abre Postman y haz clic en **Import**.
2. Selecciona el archivo `postman/validation-service.postman_collection.json` de este repositorio.
3. Abre la colección **Servicio de validaciones**. La variable `baseUrl` ya apunta a `http://localhost:3000`.
4. Ejecuta las carpetas **en orden**, o toda la colección con el **Runner** (clic derecho en la colección → *Run collection*):

| Carpeta | Qué muestra |
|---|---|
| 1. Registro (cédula nueva) | `201` con veredicto `APPROVED`, `REJECTED` y `NOT_EVALUATED`. Cada ejecución genera cédulas nuevas |
| 2. Verificación (cédula ya registrada) | `200 VERIFIED` con los datos en otro formato y `409 IDENTITY_MISMATCH` con otro nombre o país |
| 3. Consulta por id | `200` con el registro guardado, `404` y `400` |
| 4. Errores de entrada (400) | Detalle por campo: varios errores a la vez, tipos, formato, campo no permitido y JSON roto |

Cada petición trae su descripción (para qué sirve y por qué responde lo que responde) y pruebas que comprueban el código y el cuerpo, cuyo resultado se ve en la pestaña *Test Results* o en el resumen del Runner.

> La carpeta 1 hace 3 consultas a Nationalize por ejecución. Sin API key el límite es de 10 al día, así que alcanza para unas 3 ejecuciones completas (ver el aviso de abajo). Las carpetas 2, 3 y 4 no gastan cuota.

### Probar con curl

```bash
# Registro (cédula nueva) -> 201
curl -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"Jhon Garcia","documentNumber":"1020304050","countryCode":"CO"}'

# Verificación (misma cédula, nombre equivalente) -> 200
curl -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"JHON garcía","documentNumber":"1020304050","countryCode":"CO"}'

# Alerta (misma cédula, otro nombre) -> 409
curl -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"Pedro Lopez","documentNumber":"1020304050"}'
```

En **Windows PowerShell** (5.1 o 7+; arma el JSON con `ConvertTo-Json` para evitar problemas de comillas):

```powershell
$u = "http://localhost:3000/validations"

# Registro -> 201
$body = @{ name = "Jhon Garcia"; documentNumber = "1020304050"; countryCode = "CO" } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri $u -ContentType "application/json" -Body $body; $r

# Verificación -> 200
$body = @{ name = "JHON garcia"; documentNumber = "1020304050"; countryCode = "CO" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri $u -ContentType "application/json" -Body $body

# Alerta -> 409 (PowerShell trata los 4xx como error; así se ve el cuerpo de la respuesta)
$body = @{ name = "Pedro Lopez"; documentNumber = "1020304050" } | ConvertTo-Json
try { Invoke-RestMethod -Method Post -Uri $u -ContentType "application/json" -Body $body } catch { $_.ErrorDetails.Message }

# Consulta del registro creado en el primer paso
Invoke-RestMethod -Uri "$u/$($r.id)"
```

También puedes usar la colección de Postman de la carpeta `postman/`.

> **Límite de Nationalize.io:** sin API key permite **10 consultas al día** (solo los registros nuevos consultan la API). Si se agotan, el servicio responde `503 EXTERNAL_RATE_LIMITED` con `Retry-After`. Para más consultas, crea una cuenta gratuita en nationalize.io y define `NATIONALIZE_API_KEY` en un archivo `.env` (lo lee el contenedor si existe).

Para detenerlo: `docker compose down`.

## Cómo encaja en la prevención de fraude

El servicio no solo guarda registros: trata cada cédula como una identidad y detecta cuando alguien intenta usarla con datos que no corresponden.

- **Suplantación de identidad.** Si llega una cédula ya registrada con otro nombre o con otro país, responde `409 IDENTITY_MISMATCH` y deja un evento `MISMATCH_ALERT`. Es la señal típica de alguien usando un documento ajeno.
- **No filtrar información al atacante.** La alerta no dice qué campo falló ni devuelve los datos guardados. Quien prueba combinaciones de nombre y país no aprende nada del registro real. El detalle (`mismatchFields`) solo queda en la auditoría interna.
- **Historial por cédula para detectar patrones.** La auditoría usa `documentNumber` como llave de partición y la fecha como llave de ordenamiento. Con una sola consulta se obtienen todos los intentos sobre un documento en un rango de fechas: por ejemplo, muchas alertas seguidas sobre la misma cédula, o intentos desde países distintos.
- **Coherencia de la información.** Al registrar, el país declarado se compara con la nacionalidad probable del nombre (`APPROVED`, `REJECTED`, `INCONCLUSIVE`). Es una heurística, no una prueba: sirve como una señal más para combinar con otras (validación del documento, biometría, listas restrictivas).
- **Todo intento queda auditado y nada queda a medias.** Si la auditoría falla, el registro se revierte. No existe un registro sin su evento.
- **Minimización de datos.** A la API externa solo sale el primer nombre; la auditoría no guarda el nombre y los logs enmascaran la cédula (`******4050`).

## Requisitos (desarrollo sin contenedor de la app)

- Node.js 20 LTS o superior (probado con 22) y npm.
- Docker con Docker Compose para MongoDB y DynamoDB Local (las pruebas no lo necesitan).
- Acceso a internet para Nationalize.io al usar el servicio.

## Puesta en marcha (desarrollo)

```bash
# 1. Dependencias
npm install

# 2. Variables de entorno
cp .env.example .env

# 3. Solo MongoDB (27017) y DynamoDB Local (8000), sin el contenedor de la app
docker compose up -d mongo dynamodb

# 4. Tabla de auditoría en DynamoDB Local (idempotente: si ya existe, no hace nada)
npm run table:create

# 5. Arranque
npm run build && npm start      # o, en desarrollo: npm run start:dev
```

> **Importante:** DynamoDB Local corre en memoria (`-inMemory`), mientras que MongoDB persiste en un volumen. Cada vez que se reinicia el contenedor (`docker compose up`, `restart`, reinicio de Docker) la tabla de auditoría desaparece y todos los POST responden `500 AUDIT_WRITE_FAILED`. En modo desarrollo, vuelve a ejecutar `npm run table:create` después de cada reinicio de DynamoDB Local. Con `docker compose up --build` (inicio rápido) la tabla se crea sola en cada arranque.

El servicio escucha en `http://localhost:3000`. Si falta una variable obligatoria o es inválida, la app no arranca y lo indica.

### Variables de entorno

| Variable | Por defecto (`.env.example`) | Notas |
|---|---|---|
| `PORT` | `3000` | |
| `MONGO_URI` | `mongodb://localhost:27017/validations` | La base de datos sale de la URI |
| `DYNAMO_ENDPOINT` | `http://localhost:8000` | Siempre DynamoDB **Local**, nunca AWS real |
| `DYNAMO_TABLE` | `validation_audit` | |
| `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | `us-east-1` / `local` / `local` | Valores de relleno para DynamoDB Local |
| `NATIONALIZE_BASE_URL` | `https://api.nationalize.io` | |
| `NATIONALIZE_API_KEY` | vacío | **Opcional**: la API funciona sin key. Nunca se loguea |
| `NATIONALIZE_TIMEOUT_MS` | `3000` | Timeout por intento |
| `MATCH_THRESHOLD` | `0.10` | Umbral de coincidencia de país, rango [0, 1], límite inclusivo |

## Pruebas

En cada push, GitHub Actions (`.github/workflows/ci.yml`) compila el proyecto, corre las pruebas unitarias y e2e, construye la imagen Docker y valida el `docker-compose.yml`.

```bash
npm test           # unitarias: dominio y casos de uso con puertos falsos
npm run test:e2e   # e2e: app Nest completa con Supertest
```

- No usan la red real ni Docker: Nationalize se simula (con la respuesta real de `jhon` como fixture), MongoDB corre con **mongodb-memory-server** y DynamoDB se simula con **aws-sdk-client-mock**.
- **Aviso:** la primera vez que se corren las pruebas e2e, mongodb-memory-server **descarga el binario de MongoDB** (requiere internet y tarda un poco, solo esa vez). Después funcionan sin conexión.
- Cubren los criterios de aceptación de `_bmad-output/specs/spec-validation-service/acceptance-criteria.md`: los prioritarios ⭐ (AC-1, 4, 7, 9, 14, 15, 17, 19, 22) y también los opcionales (AC-2, 3, 5, 6, 8, 10, 11, 12, 13, 16, 18, 23, 24).

## API

### Body de `POST /validations`

| Campo | Tipo | Regla |
|---|---|---|
| `name` | string | **Obligatorio** (nombre completo). Se recorta; 2–100 caracteres; letras (con tildes y ñ), espacios, `'` y `-`, empezando por una letra |
| `documentNumber` | string | **Obligatorio.** Solo dígitos, de 6 a 12. String para conservar ceros a la izquierda |
| `countryCode` | string | **Opcional.** ISO 3166-1 alpha-2 (2 letras); se normaliza a mayúsculas. Ausente, `null` o `""` → no se evalúa el país (`NOT_EVALUATED`) |

No se aceptan campos adicionales (por ejemplo, `firstName`). El mínimo válido es `{ "name": "jhon garcia", "documentNumber": "1020304050" }`.

### Cómo se decide el veredicto (registro)

1. **Primer nombre:** `normalizeName(name)` (trim, minúsculas, sin tildes, espacios colapsados) y su primera palabra. `"  Jhón Anderson García "` → `jhon`. **Solo eso** se envía a Nationalize (nunca el nombre completo, la cédula ni el país); queda guardado como `firstNameSent`.
2. **Regla de nacionalidad** con la predicción de Nationalize (hasta 5 países):
   - Sin `countryCode` → `NOT_EVALUATED` (la predicción se guarda igual).
   - Predicción vacía (`country: []`) → `INCONCLUSIVE`.
   - `countryCode` aparece en la predicción con probabilidad **≥ `MATCH_THRESHOLD`** (0.10 por defecto, inclusivo) → `APPROVED`. No hace falta que sea el país más probable.
   - En otro caso → `REJECTED`.
   - Con `jhon` (CO 0.48, PE 0.15, BO 0.05): CO y PE → `APPROVED`; BO y AR → `REJECTED`.
3. `REJECTED` es un veredicto, no un error: responde `201`. El umbral vigente se guarda en cada registro (`verification.threshold`).

### Regla de coincidencia (cédula ya registrada)

- **Nombre:** se compara el nombre completo normalizado; ignora mayúsculas, tildes y espacios extra. `"JHON  García"` = `"jhon garcia"`, pero `"jhon garcia"` ≠ `"jhon garcia calvo"`.
- **País:** solo se compara si viene en la petición **y** existe en el registro. Si falta en cualquiera de los dos lados, no bloquea la verificación.
- Coincide → `200 VERIFIED` con el veredicto **original** del registro (aunque fuera `REJECTED`). No coincide → `409 IDENTITY_MISMATCH`; la respuesta no dice qué campo difiere ni devuelve datos guardados. El detalle (`mismatchFields`) solo queda en la auditoría.

### Colección de Postman

En `postman/validation-service.postman_collection.json` hay una colección con todos los casos de uso, cada uno con su descripción de **para qué** sirve y **por qué** responde lo que responde. Importa el archivo en Postman (*Import*), ajusta la variable `baseUrl` si no usas `http://localhost:3000` y ejecuta las carpetas en orden (o toda la colección con el *Runner*):

1. **Registro:** `201` con veredicto `APPROVED`, `REJECTED` y `NOT_EVALUATED`. Cada ejecución genera cédulas nuevas.
2. **Verificación:** `200 VERIFIED` y `409 IDENTITY_MISMATCH` sobre las cédulas del paso 1.
3. **Consulta por id:** `200`, `404` y `400`.
4. **Errores de entrada:** `400` con el detalle por campo.

Cada petición incluye pruebas que comprueban el código y el cuerpo de la respuesta.

### Ejemplos `curl`

**Registro con país → `201 APPROVED`** (a Nationalize se envía `name=jhon`)

```bash
curl -i -X POST http://localhost:3000/validations \
  -H "Content-Type: application/json" \
  -d '{"name":"jhon garcia","documentNumber":"1020304050","countryCode":"CO"}'
```
```json
{ "outcome": "REGISTERED", "id": "6745f1c2a9b8e4d3c2b1a0f9", "status": "APPROVED", "matchedProbability": 0.477529,
  "message": "Registro creado. El país ingresado coincide con la nacionalidad probable del nombre" }
```
Incluye la cabecera `Location: /validations/{id}`.

**Registro con país no coherente → `201 REJECTED`**

```bash
curl -i -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"jhon perez","documentNumber":"1122334455","countryCode":"AR"}'
```
```json
{ "outcome": "REGISTERED", "id": "...", "status": "REJECTED", "matchedProbability": null,
  "message": "Registro creado. El país ingresado no coincide con la nacionalidad probable del nombre" }
```
Si Nationalize no tiene datos del nombre, el estado es `INCONCLUSIVE` ("No hay datos suficientes sobre el nombre para validar el país").

**Registro sin país → `201 NOT_EVALUATED`**

```bash
curl -i -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"ana perez","documentNumber":"2030405060"}'
```
```json
{ "outcome": "REGISTERED", "id": "...", "status": "NOT_EVALUATED", "matchedProbability": null,
  "message": "Registro creado. No se evaluó el país porque no se ingresó un código de país" }
```

**Misma cédula con datos coincidentes → `200 VERIFIED`**

```bash
curl -i -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"JHON  García","documentNumber":"1020304050","countryCode":"CO"}'
```
```json
{ "outcome": "VERIFIED", "id": "6745f1c2a9b8e4d3c2b1a0f9", "status": "APPROVED", "matchedProbability": 0.477529,
  "message": "Identidad verificada: los datos coinciden con el registro" }
```

**Misma cédula con otro nombre o país → `409 IDENTITY_MISMATCH`**

```bash
curl -i -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"name":"pedro garcia","documentNumber":"1020304050","countryCode":"CO"}'
```
```json
{ "error": { "code": "IDENTITY_MISMATCH",
  "message": "Alerta: los datos ingresados no coinciden con el registro de este documento" } }
```

**Consulta por id → `200`**

```bash
curl -i http://localhost:3000/validations/6745f1c2a9b8e4d3c2b1a0f9
```
```json
{ "id": "6745f1c2a9b8e4d3c2b1a0f9", "name": "jhon garcia", "firstNameSent": "jhon", "documentNumber": "1020304050",
  "countryCode": "CO",
  "nationality": { "topCountryId": "CO", "count": 199535,
    "countries": [ { "countryId": "CO", "probability": 0.477529 }, { "countryId": "PE", "probability": 0.148882 } ] },
  "verification": { "status": "APPROVED", "matchedProbability": 0.477529, "threshold": 0.1 },
  "createdAt": "2026-11-18T15:04:05.123Z" }
```
Id válido inexistente → `404 VALIDATION_NOT_FOUND`; id mal formado (`/validations/abc`) → `400 INVALID_ID`.

**Entrada inválida → `400 VALIDATION_ERROR`** (todos los errores a la vez)

```bash
curl -i -X POST http://localhost:3000/validations -H "Content-Type: application/json" \
  -d '{"documentNumber":"12a","countryCode":"COL","extra":1}'
```
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Los datos enviados no son válidos",
  "details": [
    { "field": "name", "type": "REQUIRED", "message": "El nombre es obligatorio" },
    { "field": "documentNumber", "type": "INVALID_FORMAT", "message": "El número de documento solo puede contener dígitos" },
    { "field": "documentNumber", "type": "TOO_SHORT", "message": "El número de documento debe tener al menos 6 dígitos" },
    { "field": "countryCode", "type": "INVALID_FORMAT", "message": "El código de país debe tener 2 letras (ISO 3166-1 alpha-2), por ejemplo \"CO\"" },
    { "field": "extra", "type": "UNKNOWN_FIELD", "message": "El campo 'extra' no está permitido" }
  ] } }
```
Un JSON mal formado da `details: [{ "field": "body", "type": "INVALID_JSON", ... }]`.

### Errores

Todos los errores tienen la forma `{ "error": { "code", "message", "details?" } }`.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Body inválido, incompleto, con campos extra o JSON mal formado |
| 400 | `INVALID_ID` | `:id` no es un ObjectId (24 hex) |
| 404 | `VALIDATION_NOT_FOUND` | No existe el id |
| 404 | `NOT_FOUND` | Ruta inexistente (fuera de `POST /validations` y `GET /validations/:id`) |
| 409 | `IDENTITY_MISMATCH` | La cédula existe pero el nombre o el país no coinciden |
| 422 | `NAME_NOT_PROCESSABLE` | Al registrar: Nationalize rechaza el nombre |
| 502 | `EXTERNAL_SERVICE_ERROR` | Al registrar: timeout, error de red, 5xx o respuesta inesperada tras 1 reintento; o 401/402 (configuración) |
| 503 | `EXTERNAL_RATE_LIMITED` | Al registrar: Nationalize responde 429. Incluye `Retry-After` si la API envía `X-Rate-Limit-Reset` |
| 500 | `AUDIT_WRITE_FAILED` | Falló DynamoDB (al registrar se compensa borrando el documento de Mongo) |
| 500 | `INTERNAL_ERROR` | Cualquier otro fallo |

Ante cualquier fallo de Nationalize **no se escribe nada**: no se registra a nadie sin predicción. Los mensajes de la API externa nunca se reenvían al cliente.

## Auditoría (DynamoDB Local)

Tabla `validation_audit`, `PAY_PER_REQUEST`:

- `documentNumber` (PK) y `sk` (SK) = `eventAt#eventId`, con un UUID v4 nuevo por evento.
- Atributos: `eventId`, `eventType` (`REGISTERED` | `VERIFIED` | `MISMATCH_ALERT`), `validationId`, `status`, `countryCode` (el ingresado; se omite si no vino), `matchedProbability` (solo en `REGISTERED`), `mismatchFields` (solo en `MISMATCH_ALERT`), `eventAt`.
- No guarda nombres. El `Put` es condicional (`attribute_not_exists(sk)`).
- Toda respuesta `201`, `200` o `409` tiene su ítem; si la escritura falla, la respuesta es `500 AUDIT_WRITE_FAILED`.

Consultar los eventos de una cédula en DynamoDB Local (con AWS CLI):

```bash
aws dynamodb query --endpoint-url http://localhost:8000 --region us-east-1 \
  --table-name validation_audit \
  --key-condition-expression "documentNumber = :d" \
  --expression-attribute-values '{":d":{"S":"1020304050"}}'
```

## Arquitectura

Clean Architecture con medida, en `src/`:

```
validations/
  domain/          entidades y reglas puras (verifyNationality, matchIdentity, normalizeName, extractFirstName); sin imports externos
  application/     casos de uso (RegisterOrVerifyUseCase, GetValidationUseCase) y puertos con sus tokens de inyección
  infrastructure/  adaptadores: NationalizeProvider (fetch + timeout + reintento), MongoValidationRepository, DynamoAuditRepository
  presentation/    controlador HTTP y esquemas Zod con el catálogo de mensajes
  validations.module.ts  conecta cada puerto con su adaptador
common/            AppError, filtro global de errores, ZodValidationPipe, enmascarado de logs
config/            validación del entorno con Zod
```

Flujo del POST: validar (Zod) → buscar la cédula → **existe**: regla de coincidencia → auditar → `200`/`409` · **no existe**: Nationalize → regla de nacionalidad → insertar → auditar (si falla, se borra el documento) → `201`. Si el insert choca con el índice único (otra petición registró la misma cédula a la vez), se relee el registro y se sigue por la verificación.

## Decisiones

- **NestJS** en lugar de Express: inyección de dependencias, pipes y filtros globales, y `@nestjs/testing` para sobrescribir providers. Sin CQRS, bus de eventos ni Mongoose.
- **Zod 4.1.12** (versión exacta) con un pipe propio en lugar de class-validator, para controlar el catálogo `details[] { field, type, message }`. Se usa la API `error` de Zod 4 y `z.strictObject`.
- **Jest** en lugar de Vitest: es el estándar de NestJS y soporta los decoradores sin configuración extra.
- **Driver nativo de MongoDB** en lugar de Mongoose: el repositorio tiene cuatro operaciones.
- **SK de auditoría `eventAt#eventId`**: varios eventos del mismo registro en el mismo milisegundo no chocan.
- **`countryCode` opcional**: el enunciado solo exige nombre y documento.
- **Consistencia sobre disponibilidad**: ante un fallo de Nationalize se responde `502`/`503`/`422` sin guardar, en lugar de registrar sin enriquecer.

El detalle está en `_bmad-output/specs/spec-validation-service/`.

## Logs y datos personales

- `documentNumber` se loguea enmascarado (`******4050`); la API key nunca se loguea.
- Las alertas `MISMATCH_ALERT` se loguean en nivel `warn`; los errores de configuración de Nationalize (401/402) en `error`.
- Las respuestas de error nunca repiten el valor recibido ni los datos guardados.

## Mejoras futuras

Detalladas en [`docs/observaciones.md`](docs/observaciones.md) (sección 7):

- **Integración con la API de AUCO:** verificación de la cédula contra el registro oficial (`/validate/background`) detrás del mismo patrón de puertos, consulta asíncrona de antecedentes en listas restrictivas y un endpoint de webhooks idempotente.
- **Movimientos por cédula:** `GET /validations/audit/:documentNumber?from=&to=` sobre las llaves actuales de DynamoDB (una sola `Query`, sin escanear).
- **Alertas de fraude en tiempo real:** `GET /alerts/stream` (Server-Sent Events) con reglas de riesgo, por ejemplo varias alertas sobre la misma cédula en pocos minutos; en AWS, con DynamoDB Streams, Lambda y API Gateway WebSocket.
