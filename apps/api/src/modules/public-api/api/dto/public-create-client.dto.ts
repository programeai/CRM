import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientStatus } from '@prisma/client';

/**
 * Campos deliberadamente menores que `CreateClientDto`: só o que a API se
 * compromete a aceitar. Sem `assigneeId` (a integração não conhece os usuários
 * da workspace), sem `sourceId`, sem endereço completo.
 *
 * Os `@ApiProperty` existem só nos DTOs PÚBLICOS: é o que mantém o
 * `openapi.json` como contrato desta superfície e nada mais.
 */
export class PublicCreateClientDto {
  @ApiProperty({ example: 'Clínica Bem Viver', minLength: 2 })
  @IsString({ message: 'O nome é obrigatório.' })
  @MinLength(2, { message: 'O nome deve ter no mínimo 2 caracteres.' })
  name: string;

  @ApiPropertyOptional({ example: 'contato@bemviver.com.br' })
  @IsOptional()
  @IsEmail({}, { message: 'E-mail inválido.' })
  email?: string;

  @ApiPropertyOptional({ example: '+5584999398021' })
  @IsOptional()
  @IsString({ message: 'Telefone inválido.' })
  phone?: string;

  @ApiPropertyOptional({
    description:
      'CPF (11 dígitos) ou CNPJ (14). O tipo de pessoa é deduzido dele.',
    example: '12345678901',
  })
  @IsOptional()
  @IsString({ message: 'Documento inválido.' })
  document?: string;

  @ApiPropertyOptional({ enum: ClientStatus, default: ClientStatus.LEAD })
  @IsOptional()
  @IsEnum(ClientStatus, { message: 'Status inválido.' })
  status?: ClientStatus;

  @ApiPropertyOptional({ type: [String], example: ['erp', 'plano-ouro'] })
  @IsOptional()
  @IsArray({ message: 'As tags devem ser uma lista.' })
  @IsString({ each: true, message: 'Tag inválida.' })
  tags?: string[];

  @ApiPropertyOptional({ maxLength: 5000 })
  @IsOptional()
  @IsString({ message: 'Observações inválidas.' })
  @MaxLength(5000, {
    message: 'As observações devem ter no máximo 5000 caracteres.',
  })
  notes?: string;
}
