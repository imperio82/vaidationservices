
Construir un servicio en Node.js con dos endpoints:

- POST /validations: recibe un nombre y un número de documento, consulta una API pública gratuita (por ejemplo, una de países o de tipo de cambio) para enriquecer el registro, lo guarda en MongoDB y responde con un id.
- GET /validations/:id: devuelve el registro guardado.

Además, cada creación debe escribir un evento de auditoría en DynamoDB Local, con llave por documento y fecha.

El servicio debe incluir:

- Validación de entradas.
- Manejo de errores de la API externa.
- Al menos tres pruebas automatizadas.
- Un README que explique cómo correrlo.