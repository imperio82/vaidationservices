---
id: SPEC-validation-service
companions:
  - stack.md
  - decisions.md
  - data-flow.md
  - api-contract.md
  - data-model.md
  - error-handling.md
  - acceptance-criteria.md
  - task-plan.md
sources: []
---

> **Contrato canónico.** Este SPEC y los archivos en `companions:` son el contrato completo para construir, probar y validar. Derivado de `.memlog.md`; no editar a mano.

# Servicio de validaciones

## Why

Mandato: prueba técnica. Se entrega un servicio Node.js que registra y verifica personas por cédula. Como dice el enunciado, POST recibe un nombre (completo) y un número de documento, y opcionalmente un país. La primera vez que llega una cédula, el servidor extrae el primer nombre del nombre completo y consulta Nationalize.io **solo con él**. La API predice la nacionalidad probable; el servicio la compara con el país declarado si viene, emite un veredicto (`APPROVED`, `REJECTED`, `INCONCLUSIVE` o `NOT_EVALUATED`) y registra a la persona. Las siguientes veces, el servicio verifica que el nombre completo y el país coincidan con lo registrado para esa cédula y lanza una alerta si no coinciden. Los registros se persisten en MongoDB y cada intento queda auditado en DynamoDB Local. Debe ser robusto ante fallos externos, dar retroalimentación precisa, estar probado y poder levantarse siguiendo solo el README.

## Capabilities

- **CAP-1**
  - **intent:** Si la cédula no está registrada, un cliente registra a una persona enviando nombre completo, cédula y, opcionalmente, código de país. El sistema extrae el primer nombre, la enriquece con la predicción de nacionalidad, emite el veredicto, la guarda y devuelve su id.
  - **success:** `POST /validations` con una cédula nueva → `201` con `outcome: REGISTERED`, `id`, `status` y `message`; el documento en MongoDB contiene `name`, `nameNormalized`, `firstNameSent`, la predicción, el veredicto y `createdAt`. El mínimo válido `{ "name": "jhon garcia", "documentNumber": "1020304050" }` → `201 NOT_EVALUATED`.
- **CAP-2**
  - **intent:** Un cliente consulta un registro por su id.
  - **success:** `GET /validations/:id` → `200` con el registro; id mal formado → `400`; id inexistente → `404`.
- **CAP-3**
  - **intent:** Todo intento procesado por POST (registro, verificación o alerta) deja un evento de auditoría en DynamoDB Local, con llave por documento y fecha.
  - **success:** Tras cada `201`, `200` o `409` existe un ítem con `PK=documentNumber`, `SK=eventAt#eventId` (UUID nuevo por evento), `validationId` y `eventType` (`REGISTERED`, `VERIFIED` o `MISMATCH_ALERT`). Ninguna respuesta de esas queda sin su ítem.
- **CAP-4**
  - **intent:** Las entradas inválidas se rechazan antes de cualquier efecto, y el usuario recibe retroalimentación precisa de qué campo falló, qué tipo de error ocurrió y un mensaje legible.
  - **success:** Un body inválido, incompleto o con campos extra → `400 VALIDATION_ERROR` con todos los errores en `details[] { field, type, message }` según el catálogo de `api-contract.md`, sin consultas, llamadas externas ni escrituras.
- **CAP-5**
  - **intent:** Los fallos de Nationalize.io se manejan de forma controlada y sin dejar registros incompletos.
  - **success:** Timeout, error de red o 5xx tras 1 reintento → `502`; 401/402 → `502` sin reintento; 429 → `503` con `Retry-After`; nombre rechazado por la API → `422`. En todos los casos no hay escrituras y el servicio sigue respondiendo.
- **CAP-6**
  - **intent:** El comportamiento está cubierto por pruebas automatizadas que no dependen de la red.
  - **success:** `npm test` ejecuta ≥3 pruebas (el objetivo son los casos de `acceptance-criteria.md`) que pasan sin internet ni Docker.
- **CAP-7**
  - **intent:** Un desarrollador levanta, usa y prueba el servicio siguiendo solo el README.
  - **success:** El README cubre requisitos, `.env`, `docker compose up`, la creación de la tabla, el arranque, las pruebas, la regla de coincidencia, el flujo de registro o verificación (una persona por cédula: una cédula repetida responde `200` o `409`, nunca crea otro registro), que `countryCode` es opcional, el aviso de que mongodb-memory-server descarga el binario de MongoDB la primera vez que se corren las pruebas y ejemplos `curl` de cada respuesta.
- **CAP-8**
  - **intent:** Al registrar con `countryCode`, el sistema decide si el país declarado es coherente con la nacionalidad probable del primer nombre extraído.
  - **success:** Sin `countryCode` → `NOT_EVALUATED` (la predicción se guarda igual). Con `countryCode`: `APPROVED` si `countryCode` aparece en la predicción con probabilidad ≥ `MATCH_THRESHOLD` (por defecto 0.10, límite inclusivo); `REJECTED` si hay predicción pero no se cumple esa condición; `INCONCLUSIVE` si la API devuelve `country: []`. Con "jhon" (CO 0.48, PE 0.15, BO 0.05): CO y PE → `APPROVED`; BO y AR → `REJECTED`.
- **CAP-9**
  - **intent:** Si la cédula ya está registrada, el sistema verifica que el nombre completo y el país ingresados coincidan con los registrados y alerta si no coinciden.
  - **success:** Cédula existente, `nameNormalized` completo igual y `countryCode` igual (este solo se compara si viene en la petición **y** existe en el registro) → `200` con `outcome: VERIFIED` y el registro existente. Si difiere el nombre o el país → `409 IDENTITY_MISMATCH` con un mensaje de alerta que no revela los datos guardados. En ambos casos no se llama a Nationalize ni se escribe en MongoDB.

## Constraints

- Node.js + TypeScript + **NestJS**, con Clean Architecture con medida (domain → application con puertos → infrastructure / presentation) y principios SOLID (`stack.md`, `decisions.md`).
- Validación con Zod **4.1.12** (versión exacta) y su API de mensajes `error`, mediante un pipe propio; pruebas con Jest.
- Validaciones en MongoDB; auditoría en DynamoDB **Local**, nunca AWS real.
- Una persona por cédula: `documentNumber` es único en MongoDB.
- Enriquecimiento con Nationalize.io (`GET https://api.nationalize.io/?name=`): solo al registrar, una consulta por petición, timeout de 3 s y 1 reintento.
- `countryCode` es **opcional** (el enunciado solo exige nombre y documento). Si viene, es ISO 3166-1 **alpha-2**, porque Nationalize solo devuelve alpha-2.
- El body acepta exactamente lo que dice el enunciado: `name` (nombre completo) y `documentNumber`, más `countryCode` opcional.
- A la API externa solo se envía el primer nombre: la primera palabra de `normalizeName(name)` (trim, minúsculas, sin tildes). Nunca el nombre completo, `documentNumber` ni `countryCode`. `"  Jhón Anderson García "` → `jhon`.
- La comparación del nombre completo ignora mayúsculas, tildes y espacios extra: "Jhon  García" = "jhon garcia".
- Un `REJECTED` es un veredicto, no un error: responde `201`. Una alerta de no coincidencia es `409` y no modifica el registro.
- Consistencia sobre disponibilidad: no se registra a nadie sin predicción, y ninguna respuesta 201, 200 o 409 queda sin auditoría.
- Las pruebas nunca llaman a la API real.
- La superficie HTTP se limita a `POST /validations` y `GET /validations/:id`.

## Non-goals

- Autenticación y autorización.
- Verificación real de identidad contra registros oficiales; el veredicto de nacionalidad es solo una heurística probabilística.
- Actualizar los datos de una cédula ya registrada, o borrar o listar registros.
- Despliegue en la nube o DynamoDB en AWS; health checks; interfaz gráfica.
- Reprocesar enriquecimientos fallidos; caché de Nationalize; consultas por lotes (`name[]`); bloquear cédulas tras varias alertas.

## Success signal

- Desde un clon limpio y siguiendo solo el README: `docker compose up` + script de tabla + arranque. Luego:
  1. `POST {"name":"jhon garcia","documentNumber":"1020304050","countryCode":"CO"}` → `201 REGISTERED APPROVED` (a Nationalize se envió `name=jhon`).
  2. Repetirlo con `"name":"JHON  García"` → `200 VERIFIED`.
  3. Repetirlo con `"name":"pedro garcia"` o con `"countryCode":"PE"` → `409 IDENTITY_MISMATCH`.
  4. `POST {"name":"ana perez","documentNumber":"2030405060"}` → `201 REGISTERED NOT_EVALUATED`.
  5. El GET del id del paso 1 devuelve el registro, con `firstNameSent: "jhon"`.
  6. DynamoDB Local tiene los eventos `REGISTERED`, `VERIFIED` y `MISMATCH_ALERT` de la cédula 1020304050.
  7. `npm test` pasa los casos prioritarios ⭐ de `acceptance-criteria.md`.

## Assumptions

- En la verificación, `countryCode` solo se compara si viene en la petición y existe en el registro; si falta en cualquiera de los dos lados, no bloquea la verificación.
- Una verificación exitosa (`200`) devuelve el veredicto original del registro, aunque fuera `REJECTED`, `INCONCLUSIVE` o `NOT_EVALUATED`.
- Nationalize funciona sin API key (verificado por el usuario con `curl`). `NATIONALIZE_API_KEY` es opcional.
- El umbral de coincidencia se guarda en cada registro, para que el veredicto sea auditable aunque el umbral cambie después.
- El id es un ObjectId de MongoDB.
- Un body con campos desconocidos se rechaza (Zod `strict`). `documentNumber` se enmascara en los logs.
- Los mensajes de usuario están en español; no se devuelve el valor recibido ni los datos guardados.
