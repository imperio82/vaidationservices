# Modelo de datos

## API externa: Nationalize.io (solo al registrar)

- Request: `GET {NATIONALIZE_BASE_URL}/?name={encodeURIComponent(firstNameSent)}[&apikey={NATIONALIZE_API_KEY}]`, con `firstNameSent = normalizeName(name).split(" ")[0]`. Se envía **solo el primer nombre normalizado** (trim, minúsculas, sin tildes), nunca el nombre completo: `"  Jhón Anderson García "` → `jhon`. Una sola consulta, sin lotes y sin key obligatoria.
- Respuesta 200 (real, `name=jhon`): `{"count":199535,"name":"jhon","country":[{"country_id":"CO","probability":0.477529},{"country_id":"PE","probability":0.148882},...]}`. `country` trae hasta 5 países (alpha-2) ordenados por probabilidad descendente y puede venir vacío.
- Errores: `{ "error": string }` con 401, 402, 422 o 429. Cabeceras `X-Rate-Limit-Limit`, `X-Rate-Limit-Remaining` y `X-Rate-Limit-Reset`.
- Mapeo: `country[]` → `countries[] { countryId, probability }`; `country[0].country_id` → `topCountryId` (o `null`); `count` → `count`.

## Regla de verificación de nacionalidad (registro)

```
match = countries.find(c => c.countryId === countryCode)
matchedProbability = match?.probability ?? null
status = countryCode == null                                 → NOT_EVALUATED
       : countries.length === 0                              → INCONCLUSIVE
       : matchedProbability !== null && matchedProbability >= MATCH_THRESHOLD → APPROVED
       : REJECTED
```
`MATCH_THRESHOLD` viene del env (por defecto `0.10`, rango [0, 1], límite inclusivo). Es una función pura, sin I/O.

## Regla de coincidencia de identidad (cédula ya registrada)

```
normalizeName(s) = s.normalize("NFD").replace(/\p{Diacritic}/gu, "")
                    .toLowerCase().trim().replace(/\s+/g, " ")
extractFirstName(name) = normalizeName(name).split(" ")[0]
mismatchFields = []
if normalizeName(input.name) !== stored.nameNormalized → push "name"   # nombre completo
if input.countryCode != null && stored.countryCode != null
   && input.countryCode !== stored.countryCode → push "countryCode"   # solo si ambos existen
outcome = mismatchFields.length === 0 ? VERIFIED : MISMATCH_ALERT
```
Es una función pura y se prueba de forma unitaria. "Jhon  García" y "jhon garcia" coinciden; "jhon garcia" y "jhon garcia calvo" no coinciden (se compara el nombre completo).

## MongoDB: colección `validations` (una persona por cédula)

| Campo | Tipo | Notas |
|---|---|---|
| `_id` | ObjectId | Se expone como `id` |
| `name` | string | Nombre completo tal como se registró (trim y espacios internos colapsados) |
| `nameNormalized` | string | `normalizeName(name)`; interno, se usa para comparar en la verificación |
| `firstNameSent` | string | Valor exacto enviado a Nationalize (`extractFirstName(name)`), para auditar el enriquecimiento |
| `documentNumber` | string | Normalizado (trim); string para conservar ceros a la izquierda |
| `countryCode` | string \| null | Alpha-2 en mayúsculas, tal como lo declaró el usuario; `null` si no se ingresó |
| `nationality.topCountryId` | string \| null | |
| `nationality.count` | number | |
| `nationality.countries` | `{countryId, probability}[]` | Hasta 5, en el orden que da la API |
| `verification.status` | `APPROVED` \| `REJECTED` \| `INCONCLUSIVE` \| `NOT_EVALUATED` | Veredicto del registro; no cambia en las verificaciones |
| `verification.matchedProbability` | number \| null | |
| `verification.threshold` | number | Umbral vigente al registrar |
| `createdAt` | Date | |

Índice: `{ documentNumber: 1 }`, **único**. Las verificaciones y las alertas no modifican el documento.

## DynamoDB Local: tabla `validation_audit`

| Atributo | Tipo | Rol |
|---|---|---|
| `documentNumber` | S | **PK** (HASH) |
| `sk` | S | **SK** (RANGE) = `eventAt` ISO + `#` + `eventId`, por ejemplo `2026-11-18T15:04:05.123Z#3f2b8c1e-9d4a-4e7b-a1c2-5f6e7d8c9b0a` |
| `eventId` | S | UUID v4 nuevo por evento (`crypto.randomUUID()`); evita choques entre varios eventos del mismo registro |
| `eventType` | S | `REGISTERED` \| `VERIFIED` \| `MISMATCH_ALERT` |
| `validationId` | S | id del registro de Mongo (en `VERIFIED` y `MISMATCH_ALERT`, el del registro existente) |
| `status` | S | Veredicto del registro (`APPROVED` \| `REJECTED` \| `INCONCLUSIVE` \| `NOT_EVALUATED`) |
| `countryCode` | S | País **ingresado** en este intento; se omite si no vino |
| `matchedProbability` | N | Solo en `REGISTERED`; se omite si es `null` |
| `mismatchFields` | L | Solo en `MISMATCH_ALERT`: subconjunto de `["name","countryCode"]` |
| `eventAt` | S | ISO 8601 UTC del intento |

- El ítem no guarda nombres ni apellidos, para minimizar datos personales en la auditoría.
- Billing `PAY_PER_REQUEST`. `scripts/create-audit-table.ts` crea la tabla y es idempotente (si ya existe, no hace nada).
- Patrón de lectura habilitado: `Query PK=documentNumber` y `begins_with(sk, "2026-11-18")` para obtener todos los intentos de una cédula en una fecha, incluidas las alertas.
- La escritura usa `ConditionExpression: attribute_not_exists(sk)` para no sobrescribir eventos.
