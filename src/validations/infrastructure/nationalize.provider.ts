import { Logger } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { ERROR_MESSAGES } from '../../common/errors/error-messages';
import { NationalityProvider } from '../application/ports/nationality.provider.port';
import { Nationality } from '../domain/validation.entity';

export interface NationalizeOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  /** Total de intentos (1 + 1 reintento). */
  maxAttempts?: number;
  fetchFn?: typeof fetch;
}

interface NationalizeResponse {
  count: number;
  country: { country_id: string; probability: number }[];
}

/** Fallo transitorio (timeout, red o 5xx): es el único que se reintenta. */
class RetryableError extends Error {}

function isNationalizeResponse(body: unknown): body is NationalizeResponse {
  if (typeof body !== 'object' || body === null) return false;
  const { count, country } = body as Record<string, unknown>;
  return (
    typeof count === 'number' &&
    Array.isArray(country) &&
    country.every(
      (c: unknown) =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Record<string, unknown>).country_id === 'string' &&
        typeof (c as Record<string, unknown>).probability === 'number',
    )
  );
}

const externalServiceError = (): AppError =>
  new AppError(502, ErrorCode.EXTERNAL_SERVICE_ERROR, ERROR_MESSAGES.EXTERNAL_SERVICE_ERROR);

/**
 * Adaptador de Nationalize.io: timeout por intento, 1 reintento solo en timeout/red/5xx
 * y traducción de errores. Nunca reenvía los mensajes de la API al cliente ni loguea la key.
 */
export class NationalizeProvider implements NationalityProvider {
  private readonly logger = new Logger(NationalizeProvider.name);
  private readonly maxAttempts: number;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: NationalizeOptions) {
    this.maxAttempts = options.maxAttempts ?? 2;
    this.fetchFn = options.fetchFn ?? ((...args) => globalThis.fetch(...args));
  }

  async predict(firstName: string): Promise<Nationality> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.attempt(firstName);
      } catch (error) {
        if (!(error instanceof RetryableError)) throw error;
        this.logger.warn(`Nationalize falló (intento ${attempt}/${this.maxAttempts}): ${error.message}`);
        if (attempt >= this.maxAttempts) throw externalServiceError();
      }
    }
  }

  private buildUrl(firstName: string): string {
    const base = this.options.baseUrl.replace(/\/+$/, '');
    let url = `${base}/?name=${encodeURIComponent(firstName)}`;
    if (this.options.apiKey) url += `&apikey=${encodeURIComponent(this.options.apiKey)}`;
    return url;
  }

  private async attempt(firstName: string): Promise<Nationality> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    let response: Response;
    let rawBody: string;
    try {
      response = await this.fetchFn(this.buildUrl(firstName), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
      rawBody = await response.text();
    } catch (error) {
      const reason = controller.signal.aborted ? 'timeout' : 'error de red';
      throw new RetryableError(`${reason}${error instanceof Error ? ` (${error.name})` : ''}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 500) throw new RetryableError(`HTTP ${response.status}`);
    if (response.status === 200) return this.mapSuccess(rawBody);
    throw this.mapClientError(response, rawBody);
  }

  private mapSuccess(rawBody: string): Nationality {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = undefined;
    }
    if (!isNationalizeResponse(body)) {
      this.logger.error('Nationalize devolvió una respuesta 200 con formato inesperado');
      throw externalServiceError();
    }
    const countries = body.country.map((c) => ({ countryId: c.country_id, probability: c.probability }));
    return { topCountryId: countries[0]?.countryId ?? null, count: body.count, countries };
  }

  private mapClientError(response: Response, rawBody: string): AppError {
    const { status } = response;
    if (status === 401 || status === 402) {
      this.logger.error(`Nationalize rechazó la configuración (HTTP ${status}); revisa NATIONALIZE_API_KEY`);
      return externalServiceError();
    }
    if (status === 429) {
      const reset = response.headers.get('x-rate-limit-reset');
      this.logger.warn('Nationalize alcanzó el límite de consultas (HTTP 429)');
      return new AppError(
        503,
        ErrorCode.EXTERNAL_RATE_LIMITED,
        ERROR_MESSAGES.EXTERNAL_RATE_LIMITED,
        undefined,
        reset ? { 'Retry-After': reset } : undefined,
      );
    }
    if (status === 422) {
      if (/missing/i.test(rawBody)) {
        // Tras Zod no debería ocurrir: indica un bug propio.
        this.logger.error("Nationalize respondió 422 Missing 'name' parameter");
        return new AppError(500, ErrorCode.INTERNAL_ERROR, ERROR_MESSAGES.INTERNAL_ERROR);
      }
      return new AppError(422, ErrorCode.NAME_NOT_PROCESSABLE, ERROR_MESSAGES.NAME_NOT_PROCESSABLE, [
        { field: 'name', type: 'NOT_PROCESSABLE', message: ERROR_MESSAGES.NAME_NOT_PROCESSABLE_DETAIL },
      ]);
    }
    this.logger.error(`Nationalize respondió un estado inesperado (HTTP ${status})`);
    return externalServiceError();
  }
}
