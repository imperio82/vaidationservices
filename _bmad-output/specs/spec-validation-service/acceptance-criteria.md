# Criterios de aceptación

Cada criterio es una prueba automatizada (Jest + `@nestjs/testing` + Supertest), salvo los marcados como *manual*. Nationalize.io siempre se simula con la respuesta real de `jhon` como fixture (CO 0.477529, PE 0.148882, BO 0.047131, EC 0.026559, ES 0.024411). `MATCH_THRESHOLD = 0.10`. Los casos de registro usan cédulas distintas entre sí.

## Prioridad

**⭐ Prioritarios (obligatorios):** AC-1, AC-4, AC-7, AC-9, AC-14, AC-15, AC-17, AC-19 y AC-22. El resto es opcional si hay tiempo.

## Registro (cédula nueva)

| AC | Prioridad | CAP | Dado / Cuando | Entonces |
|---|---|---|---|---|
| AC-1 | ⭐ | CAP-1, CAP-3, CAP-8 | `{name:"Jhon Anderson García", documentNumber:"1020304050", countryCode:"co"}` | `201`, `outcome: REGISTERED`, `status: APPROVED`, `matchedProbability: 0.477529`; Mongo guarda `name`, `nameNormalized: "jhon anderson garcia"`, `firstNameSent: "jhon"`, `countryCode: "CO"`, `nationality` y `verification`; auditoría `REGISTERED` con `SK = eventAt#eventId` (UUID) y `validationId` = id del registro |
| AC-2 | opcional | CAP-8 | Cédula nueva, `countryCode: "PE"` | `201`, `APPROVED` (no hace falta ser el más probable) |
| AC-3 | opcional | CAP-8 | Cédula nueva, `countryCode: "BO"` | `201`, `REJECTED`, `matchedProbability: 0.047131` |
| AC-4 | ⭐ | CAP-8 | Cédula nueva, `countryCode: "AR"` | `201`, `REJECTED`, `matchedProbability: null`; registro y auditoría persistidos |
| AC-5 | opcional | CAP-8 | Simulado devuelve `country: []` | `201`, `INCONCLUSIVE` |
| AC-6 | opcional | CAP-8 | Unitario: probabilidad exactamente 0.10 | `APPROVED` (límite inclusivo) |
| AC-22 | ⭐ | CAP-1 | Cédula nueva, `name: "  Jhón Anderson García "` | Nationalize recibe exactamente `name=jhon`: solo la primera palabra de `normalizeName(name)` (trim, minúsculas, sin tildes), nunca el nombre completo; Mongo guarda `firstNameSent: "jhon"` |
| AC-23 | opcional | CAP-8 | Mínimo válido `{ "name": "jhon garcia", "documentNumber": "<nueva>" }`; también con `countryCode` `null` o `""` | `201`, `status: NOT_EVALUATED`, `matchedProbability: null`; Nationalize sí llamado; Mongo guarda `nationality` y `countryCode: null` |

## Verificación (cédula ya registrada en AC-1)

| AC | Prioridad | CAP | Dado / Cuando | Entonces |
|---|---|---|---|---|
| AC-7 | ⭐ | CAP-9, CAP-3 | `{name:"  JHON  anderson GARCIA ", documentNumber:"1020304050", countryCode:"CO"}` | `200`, `outcome: VERIFIED`, mismo `id` y `status: APPROVED`; Nationalize **no** llamado; Mongo sigue con 1 documento para la cédula; auditoría `VERIFIED` con un `eventId` distinto al de AC-1 |
| AC-8 | opcional | CAP-9 | Unitario `matchIdentity`: "Jhon  García" frente a "jhon garcia"; "jhon garcia" frente a "jhon garcia calvo" | Coinciden; no coinciden (se compara el nombre completo) |
| AC-9 | ⭐ | CAP-9, CAP-3 | Misma cédula, `name: "Pedro Anderson García"`, mismo país | `409 IDENTITY_MISMATCH` con mensaje de alerta, sin datos guardados en la respuesta; auditoría `MISMATCH_ALERT` con `mismatchFields: ["name"]`; Mongo sin cambios; Nationalize no llamado |
| AC-10 | opcional | CAP-9 | Misma cédula, datos iguales salvo `countryCode: "PE"` | `409`; `mismatchFields: ["countryCode"]` (PE pasaría el umbral, pero no es el país registrado) |
| AC-11 | opcional | CAP-9 | Misma cédula, nombre y país distintos | `409`; `mismatchFields: ["name","countryCode"]` |
| AC-12 | opcional | CAP-9 | Cédula registrada como `REJECTED` (AC-4), datos coincidentes | `200 VERIFIED` con `status: REJECTED` (se conserva el veredicto original) |
| AC-13 | opcional | CAP-9 | Unitario de `RegisterOrVerifyUseCase` con puertos falsos: `insert` lanza llave duplicada | Se relee el registro y se responde por el camino de verificación (`200` o `409`) |
| AC-24 | opcional | CAP-9 | Misma cédula de AC-1, nombre igual y **sin** `countryCode`; y cédula de AC-23 (sin país registrado) verificada **con** `countryCode: "CO"` | `200 VERIFIED` en ambos casos (el país solo se compara si existe en los dos lados) |

## Consulta, entrada, errores externos y auditoría

| AC | Prioridad | CAP | Dado / Cuando | Entonces |
|---|---|---|---|---|
| AC-14 | ⭐ | CAP-2 | `GET` del id de AC-1 / id válido inexistente / id `abc` | `200` con el registro completo, incluido `firstNameSent` (sin `nameNormalized`) / `404 VALIDATION_NOT_FOUND` / `400 INVALID_ID` |
| AC-15 | ⭐ | CAP-4 | Body `{ "documentNumber": "12a", "countryCode": "COL", "extra": 1 }` | `400`; `details` contiene exactamente `name/REQUIRED`, `documentNumber/INVALID_FORMAT`, `documentNumber/TOO_SHORT`, `countryCode/INVALID_FORMAT` y `extra/UNKNOWN_FIELD`, con sus mensajes en español; sin consultas a Mongo ni a Nationalize; sin escrituras |
| AC-16 | opcional | CAP-4 | JSON mal formado; `documentNumber` de 13 dígitos; `documentNumber` numérico; `name: "Ana123"`; `name: "-ana"`; `name` de 101 caracteres; body con `firstName` | `INVALID_JSON`; `TOO_LONG`; `INVALID_TYPE`; `name/INVALID_FORMAT`; `name/INVALID_FORMAT` (no empieza por letra); `name/TOO_LONG`; `firstName/UNKNOWN_FIELD` |
| AC-17 | ⭐ | CAP-5 | Cédula nueva; simulado con timeout o 5xx en ambos intentos / falla 1 vez y luego OK | `502`, exactamente 2 intentos, sin escrituras / `201` |
| AC-18 | opcional | CAP-5 | Cédula nueva; 429 con `X-Rate-Limit-Reset: 60`; 401; 422 `Invalid 'name' parameter` | `503` + `Retry-After: 60`; `502`; `422 NAME_NOT_PROCESSABLE`; 1 intento y sin escrituras en todos |
| AC-19 | ⭐ | CAP-3 | Doble de DynamoDB rechaza el `Put` en un registro / en una verificación | `500 AUDIT_WRITE_FAILED` y el documento ya no existe en Mongo / `500 AUDIT_WRITE_FAILED` y Mongo sin cambios |
| AC-20 | — | CAP-6 | `npm test` sin Docker (y sin red, una vez descargado el binario de mongodb-memory-server) | Todas las pruebas pasan |
| AC-21 | — | CAP-7 | *Manual*: clon limpio + README | Se completa el Success signal de `SPEC.md` contra la API real |

Mínimo exigido por el enunciado: 3 pruebas. Compromiso: los 9 ⭐. Objetivo completo: AC-1 a AC-24.
