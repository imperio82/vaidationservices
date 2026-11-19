import { Inject, Injectable } from '@nestjs/common';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { ERROR_MESSAGES } from '../../common/errors/error-messages';
import { Validation } from '../domain/validation.entity';
import { VALIDATION_REPOSITORY, ValidationRepository } from './ports/validation.repository.port';

@Injectable()
export class GetValidationUseCase {
  constructor(@Inject(VALIDATION_REPOSITORY) private readonly validations: ValidationRepository) {}

  async execute(id: string): Promise<Validation> {
    const validation = await this.validations.findById(id);
    if (!validation) {
      throw new AppError(404, ErrorCode.VALIDATION_NOT_FOUND, ERROR_MESSAGES.VALIDATION_NOT_FOUND);
    }
    return validation;
  }
}
