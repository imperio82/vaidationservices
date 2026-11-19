# Manejo de errores

## Flujo de POST y punto de fallo

1. **Validar con Zod.** Si falla → `400` con el catálogo de `api-contract.md`. No hay efectos.
2. **Buscar la cédula** en Mongo (`findByDocumentNumber`). Si falla → `500 INTERNAL_ERROR`.
3. **Si la cédula existe (verificación):**
   - Se aplica la regla de coincidencia de identidad (`data-model.md`). No se llama a Nationalize ni se escribe en Mongo.
   - Se escribe la auditoría `VERIFIED` o `MISMATCH_ALERT`. Si falla → `500 AUDIT_WRITE_FAILED`.
   - Si coincide → `200 VERIFIED`; si no → `409 IDENTITY_MISMATCH`.
4. **Si la cédula no existe (registro):** se consulta Nationalize.io (timeout de 3 s, máximo 2 intentos).

   | Respuesta | Reintento | Resultado |
   |---|---|---|
   | 200 con formato válido | — | Se mapea `nationality` y se aplica la regla de nacionalidad. `REJECTED`, `INCONCLUSIVE` y `NOT_EVALUATED` (sin `countryCode`) no son errores: siguen al paso 5 |
   | 200 con formato inesperado | No | `502 EXTERNAL_SERVICE_ERROR` |
   | Timeout, error de red o 5xx | Sí, 1 vez | Si persiste → `502 EXTERNAL_SERVICE_ERROR` |
   | 401 `Invalid API key` / 402 `Subscription is not active` | No | `502 EXTERNAL_SERVICE_ERROR`; log nivel `error` (es un problema de configuración, no del usuario) |
   | 422 `Invalid 'name' parameter` | No | `422 NAME_NOT_PROCESSABLE` con `details` sobre `name` |
   | 422 `Missing 'name' parameter` | No | `500 INTERNAL_ERROR` (no debería ocurrir tras Zod; indica un bug) |
   | 429 | No | `503 EXTERNAL_RATE_LIMITED` + `Retry-After` |

   En ninguno de estos casos de error hay escrituras.
5. **Insertar en Mongo.**
   - Si falla por llave duplicada (E11000: otra petición registró la misma cédula entre los pasos 2 y 5) → se relee el registro y se continúa por el paso 3 (verificación).
   - Cualquier otro fallo → `500 INTERNAL_ERROR`, sin auditoría.
6. **Escribir la auditoría `REGISTERED`.** Si falla → se borra el documento insertado en el paso 5 y se responde `500 AUDIT_WRITE_FAILED`. Si además falla el borrado, se loguea en nivel `error` con el id para conciliarlo a mano.
7. → `201 REGISTERED { id, status, matchedProbability, message }`.

## Decisión: 502 sin guardar frente a 201 sin enriquecer

| | **502 y no guardar (elegida)** | 201 guardando sin enriquecer |
|---|---|---|
| Garantía | Todo registro está completo y auditado | El registro puede quedar con `nationality: null` |
| Cliente | Debe reintentar | Nunca se bloquea |
| Coste | Ninguno extra | Hace falta un campo de estado y un reproceso (fuera de alcance) |
| Pruebas | Un camino de error simple | Más estados que verificar |

Se elige la consistencia: el veredicto depende de la predicción, así que sin predicción no hay registro que guardar. La predicción vacía es una respuesta válida de la API y se guarda como `INCONCLUSIVE`.

## Decisión: REJECTED responde 201 y la no coincidencia responde 409

- `REJECTED`: el registro se ejecutó correctamente y el veredicto es negativo. Se persiste y se audita.
- `IDENTITY_MISMATCH`: los datos ingresados entran en conflicto con el registro existente de la cédula, de ahí el `409`. Se audita como alerta y no se modifica el registro. El mensaje no revela qué campo difiere ni los datos guardados.

## Filtro global de errores

- `AppError(status, code, message, details?)` se lanza desde las capas inferiores y un único `HttpExceptionFilter` global de Nest la serializa con el formato `{ error: { code, message, details? } }`.
- Los errores de Zod se traducen a `details[] { field, type, message }` según el catálogo de `api-contract.md`. Se usan mensajes personalizados en español, nunca los mensajes por defecto de Zod, y se devuelven todos los errores, no solo el primero.
- Un JSON mal formado (error del body parser de Nest) → `400 VALIDATION_ERROR` con `type: "INVALID_JSON"`.
- Un error desconocido → `500 INTERNAL_ERROR` con mensaje genérico. El stack solo va a los logs, nunca a la respuesta.
- Los mensajes de error de Nationalize nunca se reenvían tal cual al cliente.
- Logs: `documentNumber` enmascarado (`******4050`); la API key nunca se loguea; las alertas `MISMATCH_ALERT` se loguean en nivel `warn`.
