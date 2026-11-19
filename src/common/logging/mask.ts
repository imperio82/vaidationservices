/** Enmascara un documento para logs: `1020304050` → `******4050`. */
export function maskDocument(documentNumber: string): string {
  const visible = documentNumber.slice(-4);
  return `${'*'.repeat(Math.max(documentNumber.length - visible.length, 0))}${visible}`;
}
