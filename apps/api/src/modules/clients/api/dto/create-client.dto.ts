import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PersonType, LeadSource, ClientStatus } from '@prisma/client';

export class CreateClientDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional() @IsString() tradeName?: string;

  @IsEnum(PersonType, { message: 'Tipo de pessoa inválido.' })
  personType: PersonType;

  @IsOptional() @IsString() document?: string;

  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() website?: string;

  @IsOptional()
  @IsEnum(LeadSource, { message: 'Origem inválida.' })
  source?: LeadSource;
  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;

  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @MaxLength(5000) notes?: string;

  // endereço
  @IsOptional() @IsString() zipCode?: string;
  @IsOptional() @IsString() street?: string;
  @IsOptional() @IsString() number?: string;
  @IsOptional() @IsString() complement?: string;
  @IsOptional() @IsString() district?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
}
