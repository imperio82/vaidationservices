import { Body, Controller, Get, Param, PipeTransform, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppError, ErrorCode } from '../../common/errors/app-error';
import { ERROR_MESSAGES } from '../../common/errors/error-messages';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { GetValidationUseCase } from '../application/get-validation.use-case';
import { RegisterOrVerifyUseCase } from '../application/register-or-verify.use-case';
import { Outcome, Validation, VerificationStatus } from '../domain/validation.entity';
import {
  CreateValidationDto,
  MSG,
  OBJECT_ID_PATTERN,
  createValidationSchema,
} from './validation.schema';

const REGISTERED_MESSAGES: Record<VerificationStatus, string> = {
  APPROVED: 'Registro creado. El país ingresado coincide con la nacionalidad probable del nombre',
  REJECTED: 'Registro creado. El país ingresado no coincide con la nacionalidad probable del nombre',
  INCONCLUSIVE: 'Registro creado. No hay datos suficientes sobre el nombre para validar el país',
  NOT_EVALUATED:
    'Registro creado. No se evaluó el país porque no se ingresó un código de país',
};
const VERIFIED_MESSAGE = 'Identidad verificada: los datos coinciden con el registro';

/** `:id` debe ser un ObjectId (24 hex); si no, 400 INVALID_ID. */
class ObjectIdPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!OBJECT_ID_PATTERN.test(value)) {
      throw new AppError(400, ErrorCode.INVALID_ID, ERROR_MESSAGES.INVALID_ID, [
        { field: 'id', type: 'INVALID_FORMAT', message: MSG.id.INVALID_FORMAT },
      ]);
    }
    return value;
  }
}

function toResource(v: Validation) {
  return {
    id: v.id,
    name: v.name,
    firstNameSent: v.firstNameSent,
    documentNumber: v.documentNumber,
    countryCode: v.countryCode,
    nationality: v.nationality,
    verification: v.verification,
    createdAt: v.createdAt.toISOString(),
  };
}

@Controller('validations')
export class ValidationsController {
  constructor(
    private readonly registerOrVerify: RegisterOrVerifyUseCase,
    private readonly getValidation: GetValidationUseCase,
  ) {}

  @Post()
  async create(
    @Body(new ZodValidationPipe(createValidationSchema)) body: CreateValidationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { outcome, validation } = await this.registerOrVerify.execute(body);
    const { status, matchedProbability } = validation.verification;

    if (outcome === Outcome.MISMATCH_ALERT) {
      throw new AppError(409, ErrorCode.IDENTITY_MISMATCH, ERROR_MESSAGES.IDENTITY_MISMATCH);
    }
    if (outcome === Outcome.REGISTERED) {
      res.status(201).location(`/validations/${validation.id}`);
      return { outcome, id: validation.id, status, matchedProbability, message: REGISTERED_MESSAGES[status] };
    }
    res.status(200);
    return { outcome, id: validation.id, status, matchedProbability, message: VERIFIED_MESSAGE };
  }

  @Get(':id')
  async findOne(@Param('id', new ObjectIdPipe()) id: string) {
    return toResource(await this.getValidation.execute(id));
  }
}
