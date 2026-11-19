# Decisiones técnicas

## DT-1: NestJS en lugar de Express

**Decisión:** usar NestJS con Clean Architecture con medida y principios SOLID.

| | NestJS (elegida) | Express |
|---|---|---|
| Inyección de dependencias | De serie (providers y tokens) | Manual en `app.ts` |
| Validación y errores | `Pipe` y `ExceptionFilter` globales | Middlewares a mano |
| Estructura | Módulos y capas explícitas | Libre; depende de la disciplina del equipo |
| Pruebas | `@nestjs/testing` sobrescribe los providers | Hay que inyectar dobles a mano |
| Coste | Más código repetitivo y archivos para 2 endpoints | Mínimo |

**Por qué:** mantenibilidad, herramientas y estructura. La spec ya exigía inyectar dependencias para las pruebas, y NestJS lo resuelve sin código propio.

**Para que no termine sobrediseñado:** sin CQRS, bus de eventos, Mongoose ni mappers genéricos.

### Cómo se aplica SOLID

| Principio | Aplicación |
|---|---|
| **S**: responsabilidad única | Reglas puras, caso de uso, cada adaptador y el controlador hacen una sola cosa |
| **O**: abierto a extensión | Para cambiar de proveedor de nacionalidad basta con un adaptador nuevo de `NationalityProvider` |
| **L**: sustitución | Los dobles de prueba y los adaptadores reales cumplen el mismo puerto |
| **I**: interfaces pequeñas | Un puerto por necesidad (`ValidationRepository`, `AuditRepository`, `NationalityProvider`) |
| **D**: inversión de dependencias | Los casos de uso dependen de interfaces inyectadas por token, nunca de MongoDB, DynamoDB o `fetch` |

### Clean code

- Funciones cortas con nombres del dominio (`verifyNationality`, `matchIdentity`, `registerOrVerify`).
- Sin números ni cadenas mágicas: umbral, timeout y mensajes salen de la config o del catálogo.
- Errores tipados (`AppError` con `code`) en lugar de cadenas sueltas.
- Las reglas de negocio están en `domain` y son puras, así que se prueban sin infraestructura.

## DT-2: Zod en lugar de class-validator

Se mantiene Zod con un `ZodValidationPipe` propio, para conservar bajo control el catálogo de errores `details[] { field, type, message }`. `class-validator` obligaría a adaptar sus mensajes y su forma de error.

**Versión:** Zod **4.1.12**, fijada exacta, con la API de mensajes `error` de Zod 4 (detalle en `stack.md`). Fijar la versión evita que una actualización menor cambie los códigos de los issues o la forma de los mensajes, de los que depende el catálogo.

## DT-5: SK de auditoría con eventId

`SK = eventAt + "#" + eventId`, con un UUID nuevo por evento; `validationId` va como atributo aparte. Una misma cédula y un mismo registro generan varios eventos (`REGISTERED`, `VERIFIED`, `MISMATCH_ALERT`). Con `eventAt#validationId`, dos eventos del mismo registro en el mismo milisegundo chocarían.

## DT-6: countryCode opcional

El enunciado solo exige nombre y documento. Sin `countryCode` se registra igual, con la predicción y `NOT_EVALUATED`. En la verificación, el país solo se compara si existe en ambos lados.

## DT-3: Jest en lugar de Vitest

Jest es la herramienta de pruebas por defecto de NestJS y soporta los metadatos de decoradores sin configuración extra. Con Vitest habría que añadir `unplugin-swc`, que es otro punto que puede fallar.

## DT-4: driver nativo de MongoDB en lugar de Mongoose

Para un repositorio con cinco operaciones no hace falta un ODM. El driver se expone como provider y queda detrás del puerto `ValidationRepository`.
