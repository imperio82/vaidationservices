import { OnModuleInit } from '@nestjs/common';
import { Collection, Db, MongoServerError, ObjectId, WithId } from 'mongodb';
import {
  DuplicateDocumentError,
  ValidationRepository,
} from '../application/ports/validation.repository.port';
import { NewValidation, Validation } from '../domain/validation.entity';

export const VALIDATIONS_COLLECTION = 'validations';

type ValidationDocument = NewValidation;

function toEntity(doc: WithId<ValidationDocument>): Validation {
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    nameNormalized: doc.nameNormalized,
    firstNameSent: doc.firstNameSent,
    documentNumber: doc.documentNumber,
    countryCode: doc.countryCode ?? null,
    nationality: doc.nationality,
    verification: doc.verification,
    createdAt: doc.createdAt,
  };
}

/** Adaptador de MongoDB (driver oficial). Índice único por `documentNumber`. */
export class MongoValidationRepository implements ValidationRepository, OnModuleInit {
  private readonly collection: Collection<ValidationDocument>;

  constructor(db: Db) {
    this.collection = db.collection<ValidationDocument>(VALIDATIONS_COLLECTION);
  }

  async onModuleInit(): Promise<void> {
    await this.collection.createIndex({ documentNumber: 1 }, { unique: true });
  }

  async findByDocumentNumber(documentNumber: string): Promise<Validation | null> {
    const doc = await this.collection.findOne({ documentNumber });
    return doc ? toEntity(doc) : null;
  }

  async insert(validation: NewValidation): Promise<Validation> {
    const doc: ValidationDocument = { ...validation };
    try {
      const { insertedId } = await this.collection.insertOne(doc);
      return toEntity({ ...doc, _id: insertedId });
    } catch (error) {
      if (error instanceof MongoServerError && error.code === 11000) {
        throw new DuplicateDocumentError();
      }
      throw error;
    }
  }

  async findById(id: string): Promise<Validation | null> {
    if (!ObjectId.isValid(id)) return null;
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? toEntity(doc) : null;
  }

  async deleteById(id: string): Promise<void> {
    await this.collection.deleteOne({ _id: new ObjectId(id) });
  }
}
