import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ProposalItemDto } from './proposal-item.dto';

export class CreateProposalDto {
  @IsUUID('4', { message: 'Cliente inválido.' })
  clientId: string;

  @IsOptional()
  @IsUUID('4', { message: 'Oportunidade inválida.' })
  dealId?: string;

  @IsUUID('4', { message: 'Tipo de serviço inválido.' })
  serviceTypeId: string;

  @IsArray()
  @ArrayNotEmpty({ message: 'Informe ao menos um item.' })
  @ValidateNested({ each: true })
  @Type(() => ProposalItemDto)
  items: ProposalItemDto[];

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Desconto inválido.' })
  @Min(0, { message: 'O desconto não pode ser negativo.' })
  discount?: number;

  @IsOptional() @IsString() scope?: string;
  @IsOptional() @IsString() paymentTerms?: string;
  @IsOptional() @IsString() deliveryTime?: string;

  @IsOptional()
  @IsDateString({}, { message: 'Data de validade inválida.' })
  validUntil?: string;
}
