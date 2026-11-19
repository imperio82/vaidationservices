/** Mensajes generales de error (los mensajes por campo viven en validation.schema.ts). */
export const ERROR_MESSAGES = {
  VALIDATION_ERROR: 'Los datos enviados no son válidos',
  INVALID_ID: 'El id enviado no es válido',
  VALIDATION_NOT_FOUND: 'No existe una validación con ese id',
  IDENTITY_MISMATCH: 'Alerta: los datos ingresados no coinciden con el registro de este documento',
  NAME_NOT_PROCESSABLE: 'El servicio externo no pudo procesar el nombre',
  EXTERNAL_SERVICE_ERROR: 'El servicio de nacionalidad no está disponible, intenta más tarde',
  EXTERNAL_RATE_LIMITED:
    'Se alcanzó el límite de consultas del servicio de nacionalidad, intenta más tarde',
  AUDIT_WRITE_FAILED: 'No se pudo registrar la auditoría de la operación, intenta más tarde',
  INTERNAL_ERROR: 'Ocurrió un error interno, intenta más tarde',
  NOT_FOUND: 'Recurso no encontrado',
  BODY_INVALID_JSON: 'El cuerpo de la petición no es un JSON válido',
  BODY_REQUIRED: 'El cuerpo de la petición es obligatorio',
  UNKNOWN_FIELD: (field: string): string => `El campo '${field}' no está permitido`,
} as const;
