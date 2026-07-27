import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ServiceType } from '@prisma/client';

export class CreateDealDto {
  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Estágio inválido.' })
  stageId?: string;

  @IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' })
  serviceType: ServiceType;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' })
  amount?: number;

  @IsOptional()
  @IsInt({ message: 'A probabilidade deve ser um número inteiro.' })
  @Min(0, { message: 'A probabilidade deve estar entre 0 e 100.' })
  @Max(100, { message: 'A probabilidade deve estar entre 0 e 100.' })
  probability?: number;

  @IsOptional()
  @IsDateString({}, { message: 'Data prevista inválida.' })
  expectedClose?: string;

  /**
   * Responsável. `null` limpa o campo; ausente preserva. `@IsOptional()` do
   * class-validator ignora `null` **e** `undefined`, então o `@IsUUID` só roda
   * quando vem um valor de verdade.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string | null;
}
