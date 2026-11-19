# Observaciones de la puesta en marcha local

Hallazgos de las pruebas manuales contra la API real de Nationalize.io, con MongoDB y DynamoDB Local en Docker (19 de noviembre de 2026).

## 1. Pruebas manuales realizadas

| Caso | Resultado |
|---|---|
| Registro `Jhon Anderson García`, país `CO` | `201`, `APPROVED` (CO 0.477529); a Nationalize solo se envió `jhon` |
| Misma cédula con `  JHON anderson garcia ` | `200 VERIFIED` |
| Misma cédula con otro nombre | `409 IDENTITY_MISMATCH`, auditoría `MISMATCH_ALERT` con `["name"]` |
| Misma cédula con país `PE` | `409 IDENTITY_MISMATCH`, auditoría `MISMATCH_ALERT` con `["countryCode"]` |
| `GET` del registro | `200` con la predicción completa |
| Body inválido (`12a`, `COL`, campo extra) | `400` con los 4 errores y mensajes en español |
| Sin `countryCode` | `201 NOT_EVALUATED` |
| País `AR` (no aparece en la predicción) | `201 REJECTED`, `matchedProbability: null` |
| Auditoría en DynamoDB Local | Un evento por intento: `REGISTERED`, `VERIFIED` y dos `MISMATCH_ALERT` |
| Cuota de Nationalize agotada | `503 EXTERNAL_RATE_LIMITED` con `Retry-After` |

Pruebas automatizadas: 24 unitarias y 26 e2e, todas pasan sin red ni Docker.

## 2. Error de compilación corregido

**Síntoma:** `npm run build` terminaba sin errores, pero no generaba `dist/main.js`, así que `npm start` fallaba con `Cannot find module dist/main.js`.

**Causa:** `tsconfig.json` usa `incremental: true` y el archivo `tsconfig.build.tsbuildinfo` quedaba en la raíz del proyecto. `nest-cli.json` tiene `deleteOutDir: true`, así que Nest borraba `dist`, pero TypeScript leía el `.tsbuildinfo` de la raíz, creía que nada había cambiado y no emitía archivos. Solo funcionaba la primera compilación.

**Solución:** en `tsconfig.build.json`, `"tsBuildInfoFile": "./dist/tsconfig.build.tsbuildinfo"`. Así el archivo se borra junto con `dist` y cada compilación genera todo.

## 3. Límite de Nationalize.io sin API key

Sin key, la API permite **10 consultas al día** (cabeceras `x-rate-limit-limit: 10` y `x-rate-limit-reset` en segundos). El servicio lo maneja bien (`503` + `Retry-After`), pero un revisor puede agotar la cuota probando y pensar que el servicio falla.

- Con una cuenta gratuita la cuota sube (según su FAQ, 1.000 nombres al mes compartidos entre Nationalize, Genderize y Agify).
- La key va en `.env` (`NATIONALIZE_API_KEY`), que está en `.gitignore`. Nunca en el código ni en el README.
- Solo los registros nuevos gastan cuota; verificaciones, alertas, `GET` y pruebas automatizadas no.
- Quedó documentado en el README, en "Inicio rápido".

## 4. Umbral fijo y nombres comunes

`Laura Gomez` con país `CO` salió `REJECTED`: según Nationalize, solo el 7,2 % de las personas llamadas "Laura" son de Colombia, y el umbral es 10 %. Es correcto según la regla, pero con nombres repartidos entre muchos países un umbral fijo puede rechazar a personas legítimas.

Mejoras posibles (fuera del alcance de la prueba):

- Umbral relativo: aprobar si el país declarado está entre los N más probables o si su probabilidad es al menos una fracción de la del país más probable.
- Tratar como `INCONCLUSIVE` los nombres cuya probabilidad máxima es baja (nombre poco informativo).
- Combinar la señal con otras (documento, biometría, listas restrictivas) en lugar de decidir solo con el nombre.

## 5. DynamoDB Local en memoria

`docker-compose.yml` corre DynamoDB Local con `-inMemory`: al reiniciar el contenedor se pierde la tabla y los `POST` responden `500 AUDIT_WRITE_FAILED`. Con `docker compose up --build` la tabla se crea sola (servicio `audit-table-init`); en modo desarrollo hay que correr `npm run table:create`.

## 6. Arranque con un solo comando

Se agregó `Dockerfile` (multi-stage), `.dockerignore` y dos servicios en `docker-compose.yml`:

- `audit-table-init`: usa la etapa `build` de la imagen, crea la tabla de auditoría (idempotente) con reintentos mientras DynamoDB Local arranca, y termina.
- `app`: imagen de producción (solo dependencias de producción y `dist`, usuario `node`). Espera a que MongoDB esté sano (healthcheck con `mongosh`) y a que `audit-table-init` termine bien.

Detalles:

- `MONGOMS_DISABLE_POSTINSTALL=1` en la etapa de build evita que `mongodb-memory-server` descargue el binario de MongoDB al instalar (solo se usa en pruebas).
- `.env` es opcional para el contenedor (`env_file` con `required: false`); las URLs de MongoDB y DynamoDB se fijan en `environment` con los nombres de servicio de Docker (`mongo`, `dynamodb`).
- Verificado desde cero: `docker compose down` + `docker compose up -d --build` → registro `201`, verificación `200`, alerta `409`.

## 7. Mejoras futuras (no implementadas)

### 7.1 Integración con la API de AUCO

La arquitectura ya separa al proveedor externo detrás de un puerto (`NationalityProvider`), así que se puede sumar la verificación de AUCO sin tocar el dominio ni los casos de uso.

**Adaptador `AucoIdentityProvider`** (nuevo puerto `IdentityRegistryProvider`):

- Llama a `POST {AUCO_BASE_URL}/validate/background` con `type: "CC"` (también `CE`, `PPT`) para verificar la cédula contra el registro oficial: si el documento existe y el titular está vigente.
- Entornos: pruebas `https://dev.auco.ai/v1.5/ext`, producción `https://api.auco.ai/v1.5/ext`. Se cambian por variable de entorno (`AUCO_BASE_URL`).
- Autenticación: header `Authorization` con la llave directa, sin `Bearer`. Llave privada (`prk_`) para escrituras y pública (`puk_`) para lecturas. Ambas solo en el backend, como secretos (`AUCO_PRIVATE_KEY`, `AUCO_PUBLIC_KEY`).
- Mapeo de estados al veredicto del registro:

| Estado AUCO | Efecto propuesto |
|---|---|
| `ALIVE` | Documento válido; se combina con la regla de nacionalidad |
| `NOT_FOUND`, `DECEASED` (`IDENTITY_NOT_FOUND`, `IDENTITY_DECEASED`) | Se rechaza el registro y se audita como alerta |
| `UNKNOWN`, `UNSUPPORTED`, `ERROR`, `UNAVAILABLE` | No bloquea: `INCONCLUSIVE`, igual que AUCO, que no rechaza cuando falta información |
| Valor desconocido | Se trata como no validado (AUCO advierte que pueden aparecer estados nuevos) |

- Mismo manejo de fallos que con Nationalize: timeout, un reintento en errores de red o 5xx, y error controlado sin escrituras.

**Antecedentes en listas restrictivas** (`/api/background-check/generate` y `/get`): la consulta es asíncrona (puede tardar hasta un minuto), así que se registraría la persona con estado `PENDING_BACKGROUND` y un proceso en segundo plano consultaría el resultado y actualizaría el veredicto y la auditoría.

**Webhooks de AUCO** (`POST /webhooks/auco`):

- Validar el header de autenticación configurado en AUCO (`header.key` / `header.value`); AUCO no firma con HMAC.
- Responder `200` de inmediato (AUCO espera máximo 10 s) y procesar en segundo plano.
- Idempotencia por `code` del proceso + `status`: AUCO reintenta 3 veces (a los 2, 4 y 6 minutos) y luego descarta. Como respaldo, consultar el estado con "Consultar proceso".
- Decidir con `signals[].severity` (`REPORT` y `ALERT` detienen el proceso; `INFO` no), nunca con el `code`, y aceptar códigos nuevos.

### 7.2 Movimientos por cédula y alertas de fraude en tiempo real

Hoy la auditoría se escribe pero no se expone. Propuesta:

**`GET /validations/audit/:documentNumber?from=&to=`**: historial de movimientos de una cédula.

- `Query` en DynamoDB con `documentNumber` como llave de partición y `sk BETWEEN from AND to`: una sola consulta, ordenada por fecha, sin escanear la tabla. Es justo el patrón para el que se eligieron las llaves.
- Respuesta paginada (`LastEvaluatedKey` como cursor), con `eventType`, `status`, `mismatchFields`, `countryCode` y `eventAt`.

**`GET /alerts/stream`**: alertas en tiempo real con Server-Sent Events.

- Cada `MISMATCH_ALERT` se publica en un canal de eventos y se envía a los clientes conectados (por ejemplo, un panel de analistas de fraude).
- Reglas de riesgo simples sobre la auditoría, con severidad como en AUCO (`INFO`, `ALERT`):
  - 3 o más `MISMATCH_ALERT` sobre la misma cédula en 10 minutos → `ALERT` (posible suplantación o prueba de combinaciones).
  - Intentos con países distintos sobre la misma cédula → `ALERT`.
  - Muchas cédulas distintas registradas con el mismo nombre en poco tiempo → `INFO` para revisión.

**`GET /alerts?from=&to=`**: alertas recientes de todas las cédulas.

- Requiere un índice secundario global en DynamoDB, por ejemplo `GSI1PK = eventType#fecha` y `GSI1SK = eventAt`, para consultar por tipo de evento y día sin escanear la tabla.

**En AWS (serverless):** DynamoDB Streams sobre la tabla de auditoría → Lambda que evalúa las reglas → API Gateway WebSocket (o SNS / EventBridge) para notificar en tiempo real. Así la detección no depende de la petición original y escala por separado.

**Seguridad y datos personales:** estos endpoints exponen historial sensible, así que requieren autenticación y roles (solo analistas), cédula enmascarada en las respuestas cuando no haga falta completa, y registro de quién consulta qué.

## 8. Pendientes antes de entregar

- [ ] Commit de estos cambios.
- [ ] Probar desde un clon limpio siguiendo solo el README.
- [x] CI en GitHub Actions: build, pruebas unitarias y e2e, imagen Docker y validación del compose (`.github/workflows/ci.yml`). Falta verlo en verde tras el primer push.
- [x] Sección del README sobre cómo encaja en prevención de fraude.
- [x] Ejemplos para PowerShell en el README (con `ConvertTo-Json`; los `curl.exe` con comillas escapadas fallan según cómo se invoque PowerShell).
- [ ] Las tres respuestas del formulario.
- [ ] Subir a GitHub con nombre genérico y revisar que no se suban `.env`, `_bmad/` ni `node_modules/`.
