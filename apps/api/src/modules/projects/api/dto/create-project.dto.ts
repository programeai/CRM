import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';
import { ServiceType } from '@prisma/client';

export class CreateProjectDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsEnum(ServiceType, { message: 'Tipo de serviço inválido.' })
  serviceType: ServiceType;

  @IsOptional()
  @IsUUID('4', { message: 'Proposta inválida.' })
  proposalId?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de início inválida.' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Prazo inválido.' })
  dueDate?: string;
}
