import { z } from 'zod';

/** Cadena vacía o solo espacios → undefined, para que aplique el valor por defecto. */
const emptyToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const numberWithDefault = <T extends z.ZodType>(schema: T) => z.preprocess(emptyToUndefined, schema);

/** Esquema del entorno: si falta una variable obligatoria o es inválida, la app no arranca. */
export const envSchema = z.object({
  PORT: numberWithDefault(z.coerce.number().int().positive().max(65535).default(3000)),
  MONGO_URI: z.string().trim().min(1),
  DYNAMO_ENDPOINT: z.url(),
  DYNAMO_TABLE: z.string().trim().min(1),
  AWS_REGION: z.string().trim().min(1),
  AWS_ACCESS_KEY_ID: z.string().trim().min(1),
  AWS_SECRET_ACCESS_KEY: z.string().trim().min(1),
  NATIONALIZE_BASE_URL: z.url().default('https://api.nationalize.io'),
  NATIONALIZE_API_KEY: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z.string().trim().optional(),
  ),
  NATIONALIZE_TIMEOUT_MS: numberWithDefault(z.coerce.number().int().positive().default(3000)),
  MATCH_THRESHOLD: numberWithDefault(z.coerce.number().min(0).max(1).default(0.1)),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Configuración de entorno inválida: ${problems}`);
  }
  return result.data;
}
