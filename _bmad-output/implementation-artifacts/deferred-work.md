- source_spec: `_bmad-output/implementation-artifacts/spec-validation-service.md`
  summary: Probar que MATCH_THRESHOLD se lee de la config con un valor distinto al default (p. ej. 0.2 → PE pasa a REJECTED y `verification.threshold` = 0.2).
  evidence: La suite e2e usa 0.10, igual al default del esquema; si el factory ignorara la variable, ninguna prueba fallaría.
- source_spec: `_bmad-output/implementation-artifacts/spec-validation-service.md`
  summary: Probar las ramas de respaldo del HttpExceptionFilter (ruta desconocida → 404 NOT_FOUND, excepción no controlada → 500 INTERNAL_ERROR) y los casos inválidos de validateEnv.
  evidence: Ninguna prueba toca esas ramas; son caminos de bajo riesgo fuera de los AC prioritarios.
