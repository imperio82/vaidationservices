import { NewValidation, Validation } from '../../domain/validation.entity';

export const VALIDATION_REPOSITORY = Symbol('VALIDATION_REPOSITORY');

/** El adaptador lo lanza cuando el índice único de `documentNumber` rechaza el insert (E11000). */
export class DuplicateDocumentError extends Error {
  constructor() {
    super('Ya existe un registro para ese documento');
    this.name = 'DuplicateDocumentError';
  }
}

/** Persistencia de validaciones: una persona por cédula. */
export interface ValidationRepository {
  findByDocumentNumber(documentNumber: string): Promise<Validation | null>;
  /** @throws DuplicateDocumentError si la cédula ya existe. */
  insert(validation: NewValidation): Promise<Validation>;
  findById(id: string): Promise<Validation | null>;
  deleteById(id: string): Promise<void>;
}
