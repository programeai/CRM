import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Oportunidade por chave de integração. `clientId` e `serviceTypeId` são
 * obrigatórios porque o funil não aceita card sem cliente nem sem serviço — id
 * de outro owner responde 404, e é o `ClientsService`/`CatalogosService` que
 * fecha isso. Sem `assigneeId`: a integração não conhece os usuários da
 * workspace.
 */
export class PublicCreateDealDto {
  @ApiProperty({ format: 'uuid', description: 'Cliente da workspace.' })
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @ApiProperty({ example: 'Reforma do site institucional', minLength: 2 })
  @IsString({ message: 'O título é obrigatório.' })
  @MinLength(2, { message: 'O título deve ter no mínimo 2 caracteres.' })
  title: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Item do catálogo de serviços do owner.',
  })
  @IsUUID('4', { message: 'Tipo de serviço inválido.' })
  serviceTypeId: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Ausente = primeiro estágio do funil do owner.',
  })
  @IsOptional()
  @IsUUID('4', { message: 'Estágio inválido.' })
  stageId?: string;

  @ApiPropertyOptional({ example: 12000, minimum: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Valor inválido.' })
  @Min(0, { message: 'O valor não pode ser negativo.' })
  amount?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 100, example: 40 })
  @IsOptional()
  @IsInt({ message: 'A probabilidade deve ser um número inteiro.' })
  @Min(0, { message: 'A probabilidade deve estar entre 0 e 100.' })
  @Max(100, { message: 'A probabilidade deve estar entre 0 e 100.' })
  probability?: number;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-09-30T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Data prevista inválida.' })
  expectedClose?: string;
}
