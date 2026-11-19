# Plan de tareas (en orden)

| # | Tarea | Entregable / hecho cuando | Cubre |
|---|---|---|---|
| T1 | Scaffolding | Proyecto NestJS (`nest new` o equivalente), `tsconfig` strict, Jest configurado (`test`, `test:e2e`), `.gitignore`; `npm test` corre | — |
| T2 | Infra local | `docker-compose.yml` (mongo + dynamodb-local), `.env.example`, `scripts/create-audit-table.ts` idempotente | CAP-3, CAP-7 |
| T3 | Config | `@nestjs/config` + `env.schema.ts` con Zod (`NATIONALIZE_API_KEY` opcional, `MATCH_THRESHOLD` en [0, 1]); si falta una variable obligatoria, falla al arrancar | — |
| T4 | Común: errores y validación | `AppError`, `HttpExceptionFilter` global, `ZodValidationPipe` (mapeo de issue a `type` según `stack.md`), catálogo de mensajes, `validation.schema.ts` con Zod 4.1.12 fijado | CAP-4 |
| T5 | Dominio | Entidades y reglas puras `verifyNationality`, `matchIdentity` y `normalizeName`, con pruebas unitarias (AC-6, AC-8) | CAP-8, CAP-9 |
| T6 | Puertos | Interfaces `ValidationRepository`, `AuditRepository` y `NationalityProvider`, con sus tokens de inyección | — |
| T7 | Adaptadores | `NationalizeProvider` (timeout de 3 s, 1 reintento, mapeo de errores), `MongoValidationRepository` (índice único, detección de duplicado) y `DynamoAuditRepository` (Put condicional; `SK = eventAt#eventId` con `crypto.randomUUID()`) | CAP-1, CAP-3, CAP-5 |
| T8 | Casos de uso | `RegisterOrVerifyUseCase` (buscar → verificar o registrar → auditar → compensar → carrera de duplicado) y `GetValidationUseCase`, con pruebas unitarias usando puertos falsos (AC-13) | CAP-1, CAP-3, CAP-5, CAP-9 |
| T9 | Presentación y módulo | `ValidationsController` (`outcome` → 201/200/409; `Location`), `ValidationsModule` conectando puertos y adaptadores, `main.ts` | CAP-1, CAP-2, CAP-9 |
| T10 | Pruebas e2e | Primero los AC prioritarios ⭐ de `acceptance-criteria.md`; el resto si hay tiempo. Con `@nestjs/testing` + Supertest, mongodb-memory-server, el fixture `jhon`, `NationalityProvider` simulado y aws-sdk-client-mock | CAP-6 |
| T11 | README | Requisitos, setup, flujo registrar/verificar (**una persona por cédula: una cédula repetida responde 200 VERIFIED o 409 IDENTITY_MISMATCH, nunca crea otro registro**), `countryCode` opcional y `NOT_EVALUATED`, **aviso de que mongodb-memory-server descarga el binario de MongoDB la primera vez que se corren las pruebas (requiere internet y tarda un poco solo esa vez)**, regla de coincidencia y umbral, ejemplos `curl` de cada respuesta, decisiones (`decisions.md`), arquitectura por capas, cómo probar; se verifica AC-21 a mano | CAP-7 |

Dependencias: T1 → T2/T3 → T4 → T5 → T6 → T7/T8 (en paralelo) → T9 → T10 → T11.
