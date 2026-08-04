import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ClientStatus } from '@prisma/client';

export class CreateClientDto {
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @IsOptional()
  @IsString({ message: 'Nome fantasia inválido.' })
  tradeName?: string;

  /**
   * `personType` não entra pelo corpo: é deduzido do documento no service
   * (11 dígitos = CPF/pessoa física, 14 = CNPJ/pessoa jurídica).
   */
  @IsOptional()
  @IsString({ message: 'Documento inválido.' })
  document?: string;

  @IsOptional() @IsEmail({}, { message: 'E-mail inválido.' }) email?: string;
  @IsOptional() @IsString({ message: 'Telefone inválido.' }) phone?: string;
  @IsOptional() @IsString({ message: 'Site inválido.' }) website?: string;

  @IsOptional()
  @IsUUID('4', { message: 'Origem inválida.' })
  sourceId?: string | null;
  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;

  @IsOptional()
  @IsArray({ message: 'As tags devem ser uma lista.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];

  @IsOptional()
  @IsString({ message: 'Observações inválidas.' })
  @MaxLength(5000, {
    message: 'As observações devem ter no máximo 5000 caracteres.',
  })
  notes?: string;

  /**
   * Responsável. `null` limpa o campo; ausente preserva. `@IsOptional()` do
   * class-validator ignora `null` **e** `undefined`, então o `@IsUUID` só roda
   * quando vem um valor de verdade.
   */
  @IsOptional()
  @IsUUID('4', { message: 'Responsável inválido.' })
  assigneeId?: string | null;

  // endereço
  @IsOptional() @IsString({ message: 'CEP inválido.' }) zipCode?: string;
  @IsOptional() @IsString({ message: 'Logradouro inválido.' }) street?: string;
  @IsOptional() @IsString({ message: 'Número inválido.' }) number?: string;
  @IsOptional()
  @IsString({ message: 'Complemento inválido.' })
  complement?: string;
  @IsOptional() @IsString({ message: 'Bairro inválido.' }) district?: string;
  @IsOptional() @IsString({ message: 'Cidade inválida.' }) city?: string;
  @IsOptional() @IsString({ message: 'Estado inválido.' }) state?: string;
}
