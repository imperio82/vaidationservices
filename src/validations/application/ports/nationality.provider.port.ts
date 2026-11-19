import { Nationality } from '../../domain/validation.entity';

export const NATIONALITY_PROVIDER = Symbol('NATIONALITY_PROVIDER');

/** Predicción de nacionalidad a partir de un primer nombre ya normalizado. */
export interface NationalityProvider {
  predict(firstName: string): Promise<Nationality>;
}
