---
title: 'Servicio de validaciones (NestJS): registrar o verificar por cédula'
type: 'feature'
created: '2026-11-19'
status: 'done'
route: 'dispatch'
baseline_commit: '60767d5a7944a355f8dc675540293ff53687b0ff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/specs/spec-validation-service/SPEC.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/stack.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/api-contract.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/data-model.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/error-handling.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/acceptance-criteria.md'
  - '{project-root}/_bmad-output/specs/spec-validation-service/task-plan.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** La prueba técnica pide un servicio Node.js con `POST /validations` y `GET /validations/:id` que enriquezca con una API pública, guarde en MongoDB y audite en DynamoDB Local; hoy solo existe la spec canónica, sin código.

**Approach:** Implementar en NestJS + TypeScript strict exactamente lo que define la spec canónica (`_bmad-output/specs/spec-validation-service/`), siguiendo T1..T11 de `task-plan.md`, con Clean Architecture con medida (domain → application/puertos → infrastructure/presentation). La spec canónica es la fuente de verdad ante cualquier duda.

## Boundaries & Constraints

**Always:**
- Una persona por cédula (índice único); cédula nueva → registrar (201), existente → verificar (200) o alertar (409) sin escribir en Mongo ni llamar a Nationalize.
- A Nationalize solo se envía `extractFirstName(name)`; timeout 3 s, 1 reintento solo en timeout/red/5xx.
- Zod `4.1.12` exacto, API `error` de Zod 4, `z.strictObject`; catálogo de mensajes en español de `api-contract.md`, todos los errores a la vez.
- Toda respuesta 201/200/409 tiene su ítem de auditoría (`SK = eventAt#eventId`); fallo de auditoría en registro → compensar borrando el doc.
- `domain` sin imports externos; casos de uso dependen solo de puertos inyectados por token.
- Pruebas sin red real ni Docker (Nationalize simulado, mongodb-memory-server, aws-sdk-client-mock).
- Un commit de git por cada tarea T1..T11 al completarla (pedido explícito del usuario).

**Never:** Mongoose, class-validator, CQRS/bus de eventos, AWS real, endpoints extra, autenticación, reenviar mensajes de Nationalize al cliente, loguear la API key o el documento sin enmascarar, devolver en 409 qué campo difiere.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Registro con país | cédula nueva, `countryCode` en predicción ≥ 0.10 | 201 REGISTERED APPROVED + auditoría | N/A |
| Registro sin país | cédula nueva, sin `countryCode` | 201 NOT_EVALUATED, predicción guardada | N/A |
| Verificación | cédula existe, nombre normalizado igual | 200 VERIFIED con veredicto original | auditoría falla → 500 AUDIT_WRITE_FAILED |
| Alerta | cédula existe, nombre o país distinto | 409 IDENTITY_MISMATCH, `mismatchFields` solo en auditoría | idem |
| Entrada inválida | body con errores/campos extra/JSON roto | 400 VALIDATION_ERROR con `details[]` | sin efectos |
| Fallo externo | timeout/5xx ×2, 401/402, 422, 429 | 502 / 502 / 422 / 503 + Retry-After | sin escrituras |
| Carrera | insert lanza E11000 | relee y sigue por verificación | N/A |

</frozen-after-approval>

## Code Map

Proyecto nuevo: no hay código existente que reutilizar ni preservar. Estructura destino definida en `stack.md` (sección "Capas"). No tocar `_bmad/`, `.claude/`, `docs/` ni la spec canónica.

- `package.json`, `tsconfig*.json`, `nest-cli.json`, `jest` config -- scaffolding (T1)
- `docker-compose.yml`, `.env.example`, `scripts/create-audit-table.ts` -- infra local (T2)
- `src/config/env.schema.ts`, `src/app.module.ts` -- config validada con Zod (T3)
- `src/common/{errors,pipes}/*`, `src/validations/presentation/validation.schema.ts` -- errores y validación (T4)
- `src/validations/domain/*` -- entidades y reglas puras (T5)
- `src/validations/application/ports/*` -- puertos y tokens (T6)
- `src/validations/infrastructure/*` -- adaptadores Nationalize/Mongo/Dynamo (T7)
- `src/validations/application/*.use-case.ts` -- casos de uso (T8)
- `src/validations/presentation/validations.controller.ts`, `validations.module.ts`, `src/main.ts` -- HTTP (T9)
- `test/unit/*`, `test/e2e/*` -- pruebas (T5, T8, T10)
- `README.md` -- documentación (T11)

## Tasks & Acceptance

**Execution:**
- [x] T1 `package.json` & config -- scaffolding NestJS a mano (sin `nest new` interactivo), TS strict, scripts `build/start/start:dev/test/test:e2e`, `.gitignore` con `dist/` y `coverage/` -- base ejecutable
- [x] T2 `docker-compose.yml`, `.env.example`, `scripts/create-audit-table.ts` -- mongo:7 + dynamodb-local, tabla idempotente -- CAP-3, CAP-7
- [x] T3 `src/config/env.schema.ts` -- env validado al arrancar -- falla rápido
- [x] T4 `src/common/*`, `validation.schema.ts` -- AppError, filtro global, ZodValidationPipe con mapeo issue→type, catálogo -- CAP-4
- [x] T5 `src/validations/domain/*` + `test/unit/domain.spec.ts` -- reglas puras (AC-6, AC-8) -- CAP-8, CAP-9
- [x] T6 `src/validations/application/ports/*` -- interfaces + tokens -- DIP
- [x] T7 `src/validations/infrastructure/*` -- adaptadores con timeout/reintento/mapeo, índice único, Put condicional -- CAP-1, CAP-3, CAP-5
- [x] T8 casos de uso + `test/unit/register-or-verify.spec.ts` -- orquestación, compensación, carrera (AC-13) -- CAP-1/3/5/9
- [x] T9 controller, módulo, `main.ts` -- outcome→201/200/409, `Location` -- CAP-1, CAP-2
- [x] T10 `test/e2e/validations.e2e-spec.ts` -- los 9 AC ⭐ primero, luego opcionales -- CAP-6
- [x] T11 `README.md` -- contenido de CAP-7 -- CAP-7

**Acceptance Criteria:**
- Given la spec canónica, when se ejecuta `npm test` y `npm run test:e2e`, then pasan AC-1, AC-4, AC-7, AC-9, AC-14, AC-15, AC-17, AC-19 y AC-22 de `acceptance-criteria.md` sin red ni Docker.
- Given el repo, when se revisa `git log`, then hay un commit por cada tarea T1..T11.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pasada 1 (iteración 0). Capas: verification-gap (VG), blind-hunter (BH), edge-case-hunter (EC).

| # | Capa | Hallazgo | Veredicto | Evidencia | Ruta |
|---|---|---|---|---|---|
| 1 | VG | Índice único y traducción E11000 sin prueba real (solo fake) | medium | Gap pre-verificado; quitar `unique: true` no rompe ninguna prueba | patch |
| 2 | VG | `apikey` en URL y factory de NATIONALITY_PROVIDER sin prueba | low | Gap pre-verificado; e2e sobrescribe el provider sin key | patch |
| 3 | VG | Cableado de MATCH_THRESHOLD indistinguible del default | medium | Gap pre-verificado; e2e usa 0.10 = default | defer |
| 4 | VG | 200 malformado, 402, 422 Missing y 4xx inesperado sin prueba | medium | Gap pre-verificado; AC-18 solo cubre 429/401/422 Invalid | patch |
| 5 | VG | Omisión de `countryCode` en la auditoría sin aserción | low | Gap pre-verificado; AC-23 no mira `putItems()` | patch |
| 6 | VG | Fallo del borrado compensatorio sin prueba | low | Gap pre-verificado; fakes siempre borran bien | patch |
| 7 | VG | `validateEnv` y ramas de respaldo del filtro sin prueba | low | Gap pre-verificado | defer |
| 8 | VG/BH/EC | Parser `.env` del script no recorta espacios ni comillas | low | `(.*)\s*$` codicioso conserva espacios; comillas quedan en el valor | patch (corrección directa) |
| 9 | BH/EC | `MATCH_THRESHOLD=` vacío se convierte en 0 y aprueba todo | medium | Verificado: `z.coerce.number().default(0.1).parse('')` → 0 | patch |
| 10 | EC | `PORT` sin máximo 65535; vacío no usa el default | low | `.positive()` sin `.max`; mismo `coerce('')` → 0 | patch (junto a #9) |
| 11 | BH | Regex `transform` de Jest es `^.+.ts$` | low | Verificado: `'\.'` en string JS queda `.` | patch |
| 12 | BH/EC | Nombres en NFD rechazados como INVALID_FORMAT | medium | Verificado: regex falla con `'García'`; Zod 4 tiene `.normalize()` | patch |
| 13 | BH | DynamoDB Local `-inMemory` pierde la tabla al reiniciar; Mongo persiste | medium | `docker-compose.yml` usa `-inMemory` y volumen solo para Mongo; README no avisa | patch (nota en README) |
| 14 | BH/EC | Carrera: verificación concurrente antes del borrado compensatorio | low | Real pero requiere ventana de ms entre insert y fallo de auditoría; arreglo exige estado pending | rechazado (low, arreglo complejo) |
| 15 | BH/EC | 4xx de Nest distintos de 404 etiquetados VALIDATION_ERROR; NOT_FOUND ausente del README | low | Filtro mapea todo <500 no-404 a VALIDATION_ERROR; tabla README sin NOT_FOUND | patch solo la fila del README; resto rechazado (raro, añade ramas) |
| 16 | BH | Éxito de `GetValidationUseCase` sin aserción unitaria | low | Cubierto por AC-14 e2e; el título de la unitaria promete más de lo que verifica | patch (aserción directa) |
| 17 | BH | Pruebas e2e dependen del orden | low | Real (estado compartido en el describe); arreglo es reestructurar | rechazado (low, arreglo no directo) |
| 18 | BH | `topCountryId` asume orden de la API | false | data-model.md fija `country[0].country_id → topCountryId`; la API ordena desc | rechazado |
| 19 | BH | `maskDocument` muestra 4 de 6 dígitos | low | Formato `******4050` lo fija error-handling.md | rechazado (definido por spec) |
| 20 | BH | GET sin autenticación ni health/rate limit | false | Non-goals de SPEC.md: autenticación y health checks | rechazado |
| 21 | BH | Faltan scripts lint/format/test:cov | low | No requerido; sin daño concreto | rechazado |
| 22 | BH | `countryCode` solo valida forma (XX pasa) | false | api-contract.md define `/^[A-Za-z]{2}$/`; XX → REJECTED es el veredicto previsto | rechazado |
| 23 | EC | Nombre solo con letras modificadoras diacríticas normaliza a vacío | low | Entrada inverosímil; guardia añade rama | rechazado |
| 24 | EC | MONGO_URI sin base de datos usa `test` | low | `.env.example` incluye `/validations`; comportamiento estándar del driver | rechazado |
| 25 | EC | Put de Dynamo exitoso pero con error de cliente → auditoría huérfana | low | Ambigüedad de red rara; arreglo complejo | rechazado |
| 26 | EC | Ganador compensado antes de releer → 500 | low | Requiere doble carrera; 500 es respuesta aceptable | rechazado |
| 27 | EC | `maxAttempts` 0/negativo | false | Opción interna; el módulo nunca la pasa (default 2) | rechazado |
| 28 | EC | `X-Rate-Limit-Reset` no numérico reenviado | low | Nationalize envía segundos; api-contract fija Retry-After = header | rechazado |
| 29 | EC | Cliente DynamoDB no se destruye al apagar | low | Sin cuelgue demostrado (las pruebas terminan) | rechazado |
| 30 | EC | "sin red ni Docker" falso por descarga del binario | false | AC-20 dice "sin red, una vez descargado el binario"; README lo avisa | rechazado |

## Design Notes

- Entorno: Node v22.17.1 (la spec pide 20 LTS; 22 es compatible y se fija `engines >=20`). Docker no está instalado en esta máquina: no afecta las pruebas automáticas, pero AC-21 (manual con docker compose) no podrá verificarse aquí.
- `nest new` es interactivo; se crea el scaffolding a mano con las dependencias equivalentes.

## Verification

**Commands:**
- `npm run build` -- expected: compila sin errores
- `npm test` -- expected: todas las unitarias pasan
- `npm run test:e2e` -- expected: los AC ⭐ pasan

**Manual checks (if no CLI):**
- AC-21: seguir el README con Docker (no disponible en esta máquina).
